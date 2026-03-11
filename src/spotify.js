/**
 * spotify.js – Per-admin Spotify Web API client.
 *
 * Exports:
 *   SpotifyClient  – class, one instance per authenticated admin
 *   extractPlaylistId – utility to parse playlist URLs / URIs / raw IDs
 *   buildAuthUrl      – returns the Spotify OAuth redirect URL
 *   exchangeCode      – exchanges an auth code for token objects
 */

'use strict';

const SpotifyWebApi = require('spotify-web-api-node');

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
];

/** One minute buffer before token expiry triggers a refresh. */
const TOKEN_REFRESH_BUFFER_MS = 60_000;

function _makeApi(redirectUri) {
  return new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri:
      redirectUri ||
      process.env.SPOTIFY_REDIRECT_URI ||
      'http://localhost:3000/auth/spotify/callback',
  });
}

// ─── Stateless helpers ────────────────────────────────────────────────────────

/**
 * Extract a Spotify playlist ID from a URL, URI, or raw ID string.
 */
function extractPlaylistId(input) {
  if (!input) return null;
  const urlMatch = input.match(/playlist\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = input.match(/spotify:playlist:([A-Za-z0-9]+)/);
  if (uriMatch) return uriMatch[1];
  if (/^[A-Za-z0-9]{22}$/.test(input)) return input;
  return null;
}

/**
 * Build the Spotify OAuth authorise URL.
 * @param {string} state  CSRF token.
 * @param {string} [redirectUri]  Explicit redirect URI (overrides env/default).
 * @returns {string}
 */
function buildAuthUrl(state, redirectUri) {
  return _makeApi(redirectUri).createAuthorizeURL(SCOPES, state);
}

/**
 * Exchange an authorisation code for access + refresh tokens.
 * @param {string} code
 * @param {string} [redirectUri]  Must exactly match the URI used to build the auth URL.
 * @returns {Promise<{ accessToken, refreshToken, expiresAt }>}
 */
async function exchangeCode(code, redirectUri) {
  const api = _makeApi(redirectUri);
  const data = await api.authorizationCodeGrant(code);
  return {
    accessToken: data.body.access_token,
    refreshToken: data.body.refresh_token,
    expiresAt: Date.now() + data.body.expires_in * 1000,
  };
}

// ─── SpotifyClient class ──────────────────────────────────────────────────────

/**
 * Stateful Spotify client bound to a single user's tokens.
 * Automatically refreshes the access token when it approaches expiry.
 */
class SpotifyClient {
  /**
   * @param {{ accessToken: string, refreshToken: string, expiresAt: number }} tokens
   */
  constructor(tokens) {
    this._api = _makeApi();
    this._api.setAccessToken(tokens.accessToken);
    this._api.setRefreshToken(tokens.refreshToken);
    this._expiresAt = tokens.expiresAt;
  }

  /** Returns the current (possibly refreshed) token snapshot. */
  getTokens() {
    return {
      accessToken: this._api.getAccessToken(),
      refreshToken: this._api.getRefreshToken(),
      expiresAt: this._expiresAt,
    };
  }

  async _ensureValidToken() {
    if (Date.now() < this._expiresAt - TOKEN_REFRESH_BUFFER_MS) return;
    try {
      const data = await this._api.refreshAccessToken();
      this._api.setAccessToken(data.body.access_token);
      this._expiresAt = Date.now() + data.body.expires_in * 1000;
    } catch (err) {
      console.error('Failed to refresh Spotify token:', err.message);
    }
  }

  /**
   * Fetch all playlists owned by (or followed by) the authenticated user.
   * @returns {Promise<Array<{ id, name, trackCount, imageUrl }>>}
   */
  async getUserPlaylists() {
    await this._ensureValidToken();
    const limit = 50;
    let offset = 0;
    let total = Infinity;
    const playlists = [];

    while (offset < total) {
      const data = await this._api.getUserPlaylists({ limit, offset });
      total = data.body.total;
      for (const pl of data.body.items) {
        playlists.push({
          id: pl.id,
          name: pl.name,
          trackCount: pl.tracks.total,
          imageUrl: pl.images && pl.images[0] ? pl.images[0].url : null,
        });
      }
      offset += limit;
    }

    return playlists;
  }

  /**
   * Fetch all tracks from a playlist (handles Spotify's 100-item page limit).
   * @param {string} playlistId
   * @returns {Promise<Array<Object>>}  Normalised song objects.
   */
  async getPlaylistSongs(playlistId) {
    await this._ensureValidToken();

    const limit = 100;
    let offset = 0;
    let total = Infinity;
    const songs = [];

    while (offset < total) {
      const data = await this._api.getPlaylistTracks(playlistId, {
        limit,
        offset,
        fields:
          'total,items(track(id,name,artists,album(name,images),duration_ms,preview_url,is_playable,restrictions))',
      });

      const body = data.body;
      total = body.total;

      for (const item of body.items) {
        const track = item.track;
        if (!track || !track.id) continue; // skip local / null tracks
        if (track.is_playable === false) continue; // skip tracks blocked in the user's market

        songs.push({
          id: track.id,
          name: track.name,
          artists: track.artists.map((a) => a.name).join(', '),
          album: track.album.name,
          albumArt:
            track.album.images && track.album.images[0]
              ? track.album.images[0].url
              : null,
          durationMs: track.duration_ms,
          previewUrl: track.preview_url,
        });
      }

      offset += limit;
    }

    return songs;
  }

  /**
   * Create a new Spotify playlist for the authenticated user containing a
   * random subset of tracks from an existing playlist.
   * @param {string} sourcePlaylistId  Spotify playlist ID to sample from.
   * @param {number} songCount         Number of tracks to include (clamped to the source playlist size).
   * @param {string} [name]            Name for the new playlist. Defaults to "Music Bingo – <N> songs".
   * @returns {Promise<{ id: string, name: string, trackCount: number, externalUrl: string }>}
   */
  async createPlaylistFromPlaylist(sourcePlaylistId, songCount, name) {
    await this._ensureValidToken();

    const songs = await this.getPlaylistSongs(sourcePlaylistId);
    if (songs.length < 24) {
      throw new Error(`Source playlist only has ${songs.length} tracks. At least 24 are required.`);
    }

    const count = Math.min(Math.max(1, songCount), songs.length);
    // Fisher-Yates shuffle, then take the first `count` items.
    const shuffled = songs.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const selected = shuffled.slice(0, count);

    const me = await this._api.getMe();
    const userId = me.body.id;

    const playlistName = name || `Music Bingo – ${count} songs`;
    const created = await this._api.createPlaylist(userId, {
      name: playlistName,
      public: false,
      description: `Auto-generated Music Bingo playlist with ${count} tracks.`,
    });
    const newPlaylistId = created.body.id;
    const externalUrl = created.body.external_urls && created.body.external_urls.spotify;

    // Spotify's add-tracks endpoint accepts at most 100 URIs per request.
    const trackUris = selected.map((s) => `spotify:track:${s.id}`);
    for (let i = 0; i < trackUris.length; i += 100) {
      await this._api.addTracksToPlaylist(newPlaylistId, trackUris.slice(i, i + 100));
    }

    return {
      id: newPlaylistId,
      name: playlistName,
      trackCount: count,
      externalUrl: externalUrl || null,
    };
  }

  /**
   * Get the currently-playing track.
   * Returns null if nothing is actively playing.
   * @returns {Promise<Object|null>}
   */
  async getCurrentlyPlaying() {
    await this._ensureValidToken();
    try {
      const data = await this._api.getMyCurrentPlayingTrack();
      if (!data.body || !data.body.item || !data.body.is_playing) return null;

      const track = data.body.item;
      return {
        id: track.id,
        name: track.name,
        artists: track.artists.map((a) => a.name).join(', '),
        album: track.album.name,
        albumArt:
          track.album.images && track.album.images[0]
            ? track.album.images[0].url
            : null,
        progressMs: data.body.progress_ms,
        durationMs: track.duration_ms,
      };
    } catch (err) {
      console.error('Error fetching currently playing:', err.message);
      return null;
    }
  }
}

module.exports = { SpotifyClient, extractPlaylistId, buildAuthUrl, exchangeCode };

