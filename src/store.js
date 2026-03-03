/**
 * store.js – In-memory per-admin data store.
 *
 * Holds one AdminData instance per Google user ID.
 * Also maintains a global card-ID → admin-ID index for fast card lookups.
 */

'use strict';

const GameState = require('./game');
const { SpotifyClient } = require('./spotify');

class AdminData {
  /**
   * @param {{ googleId, email, name, picture }} profile
   */
  constructor(profile) {
    this.googleId = profile.googleId;
    this.email    = profile.email;
    this.name     = profile.name;
    this.picture  = profile.picture || null;

    /** @type {SpotifyClient|null} */
    this.spotifyClient = null;

    /** @type {GameState} */
    this.game = new GameState();

    /** @type {NodeJS.Timeout|null} Spotify poll interval for active game. */
    this._pollTimer = null;

    /** @type {string|null} Track ID of the last song emitted. */
    this._lastSongId = null;
  }

  hasSpotify() {
    return this.spotifyClient !== null;
  }

  setSpotifyTokens(tokens) {
    this.spotifyClient = new SpotifyClient(tokens);
  }
}

class AdminStore {
  constructor() {
    /** @type {Map<string, AdminData>} googleId → AdminData */
    this._admins = new Map();

    /** @type {Map<string, string>} cardId → googleId */
    this._cardIndex = new Map();
  }

  /**
   * Return the AdminData for `googleId`, creating it if it doesn't exist.
   * Profile fields (name, email, picture) are always refreshed from Google so
   * the displayed name is always current even if the admin logs in multiple
   * times within a single server session.
   * @param {string} googleId
   * @param {{ googleId, email, name, picture }} profile
   * @returns {AdminData}
   */
  getOrCreate(googleId, profile) {
    let admin = this._admins.get(googleId);
    if (!admin) {
      admin = new AdminData(profile);
      this._admins.set(googleId, admin);
    } else {
      // Refresh profile fields so they are always current from Google.
      admin.email   = profile.email;
      admin.name    = profile.name;
      admin.picture = profile.picture || null;
    }
    return admin;
  }

  /**
   * @param {string} googleId
   * @returns {AdminData|null}
   */
  getAdmin(googleId) {
    return this._admins.get(googleId) || null;
  }

  /**
   * Register a batch of newly generated cards in the global index.
   * @param {string} googleId
   * @param {Array<{ id: string }>} cards
   */
  indexCards(googleId, cards) {
    for (const card of cards) {
      this._cardIndex.set(card.id, googleId);
    }
  }

  /**
   * Remove all cards for an admin from the global index
   * (called on game reset so stale card IDs don't linger).
   * @param {string} googleId
   */
  deindexCards(googleId) {
    const toDelete = [];
    for (const [cardId, adminId] of this._cardIndex) {
      if (adminId === googleId) toDelete.push(cardId);
    }
    for (const cardId of toDelete) this._cardIndex.delete(cardId);
  }

  /**
   * Find the admin whose active game matches the given gameId.
   * @param {string} gameId
   * @returns {AdminData|null}
   */
  findAdminByGameId(gameId) {
    for (const admin of this._admins.values()) {
      if (admin.game && admin.game.gameId === gameId) return admin;
    }
    return null;
  }

  /**
   * Find a card by ID across all admins.
   * @param {string} cardId
   * @returns {{ admin: AdminData, card: Object }|null}
   */
  findCard(cardId) {
    const adminId = this._cardIndex.get(cardId);
    if (!adminId) return null;
    const admin = this._admins.get(adminId);
    if (!admin) return null;
    const card = admin.game.getCardById(cardId);
    return card ? { admin, card } : null;
  }
}

module.exports = new AdminStore();
