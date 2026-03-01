/**
 * spotify.js – Spotify Web API wrapper.
 *
 * Handles OAuth 2.0 authorization code flow and exposes helpers for:
 *   • Fetching all tracks from a playlist (handles pagination).
 *   • Getting the user's currently-playing track.
 */

'use strict';

const SpotifyWebApi = require('spotify-web-api-node');

const scopes = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
];

/** One minute buffer before token expiry triggers a refresh. */
const TOKEN_REFRESH_BUFFER_MS = 60_000;

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri:
    process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/auth/callback',
});

// ─── Token state ──────────────────────────────────────────────────────────────

let _tokenExpiresAt = 0; // epoch ms

function isAuthenticated() {
  return !!spotifyApi.getAccessToken();
}

async function ensureValidToken() {
  if (!isAuthenticated()) return;
  if (Date.now() < _tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) return; // still valid

  try {
    const data = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(data.body.access_token);
    _tokenExpiresAt = Date.now() + data.body.expires_in * 1000;
  } catch (err) {
    console.error('Failed to refresh Spotify token:', err.message);
  }
}

// ─── Auth route handlers ──────────────────────────────────────────────────────

function getAuthUrl(req, res) {
  const state = Math.random().toString(36).substring(2, 18);
  const authUrl = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authUrl);
}

async function handleCallback(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/admin?auth_error=${encodeURIComponent(error)}`);
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    spotifyApi.setAccessToken(data.body.access_token);
    spotifyApi.setRefreshToken(data.body.refresh_token);
    _tokenExpiresAt = Date.now() + data.body.expires_in * 1000;
    res.redirect('/admin?auth_success=1');
  } catch (err) {
    console.error('Spotify auth error:', err.message);
    res.redirect(`/admin?auth_error=${encodeURIComponent(err.message)}`);
  }
}

// ─── Playlist fetching ────────────────────────────────────────────────────────

/**
 * Extract a Spotify playlist ID from a URL or raw ID string.
 * Accepts formats like:
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
 *   37i9dQZF1DXcBWIGoYBM5M
 */
function extractPlaylistId(input) {
  if (!input) return null;

  // URL format
  const urlMatch = input.match(/playlist\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // URI format
  const uriMatch = input.match(/spotify:playlist:([A-Za-z0-9]+)/);
  if (uriMatch) return uriMatch[1];

  // Raw ID (22 alphanumeric chars)
  if (/^[A-Za-z0-9]{22}$/.test(input)) return input;

  return null;
}

/**
 * Fetch all tracks from a Spotify playlist (handles Spotify's 100-item page limit).
 * @param {string} playlistId
 * @returns {Promise<Array<Object>>}  Normalised song objects.
 */
async function getPlaylistSongs(playlistId) {
  await ensureValidToken();

  const limit = 100;
  let offset = 0;
  let total = Infinity;
  const songs = [];

  while (offset < total) {
    const data = await spotifyApi.getPlaylistTracks(playlistId, {
      limit,
      offset,
      fields: 'total,items(track(id,name,artists,album(name,images),duration_ms,preview_url))',
    });

    const body = data.body;
    total = body.total;

    for (const item of body.items) {
      const track = item.track;
      // Skip local files or null tracks
      if (!track || !track.id) continue;

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

// ─── Currently playing ────────────────────────────────────────────────────────

/**
 * Get the currently-playing track from the authorised user's Spotify account.
 * Returns null if nothing is playing or if not authenticated.
 * @returns {Promise<Object|null>}
 */
async function getCurrentlyPlaying() {
  if (!isAuthenticated()) return null;

  await ensureValidToken();

  try {
    const data = await spotifyApi.getMyCurrentPlayingTrack();
    if (
      !data.body ||
      !data.body.item ||
      !data.body.is_playing
    ) {
      return null;
    }

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

module.exports = {
  spotifyApi,
  isAuthenticated,
  getAuthUrl,
  handleCallback,
  getPlaylistSongs,
  getCurrentlyPlaying,
  extractPlaylistId,
};
