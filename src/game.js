/**
 * game.js – GameState class (one instance per admin).
 *
 * Exported as a class so each admin gets their own instance via the store.
 *
 * State lifecycle:
 *   idle  →  (generate cards)  →  active  →  ended  →  idle (reset)
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

class GameState {
  constructor() {
    this._reset();
  }

  _reset() {
    /** Opaque room ID shared by admin + all players of this game. */
    this.gameId = null;

    /** @type {'idle'|'active'|'ended'} */
    this.status = 'idle';

    /** @type {Array<Object>} Generated bingo cards */
    this.cards = [];

    /** @type {Array<Object>} All songs from the current playlist */
    this.playlistSongs = [];

    /** @type {string|null} Spotify playlist ID used for card generation */
    this.playlistId = null;

    /** @type {Object|null} Currently playing Spotify track (or null) */
    this.currentSong = null;

    /**
     * Ordered list of songs that have been "played" during this game session.
     * @type {Array<Object>}
     */
    this.playedSongs = [];

    /**
     * Set of played Spotify track IDs (fast lookup).
     * @type {Set<string>}
     */
    this.playedSongIds = new Set();

    /**
     * Validated bingo claims, sorted by claimedAt ascending.
     * @type {Array<Object>}
     */
    this.winners = [];

    /** @type {string|null} ISO timestamp when the game started */
    this.startedAt = null;

    /** @type {string|null} ISO timestamp when the game ended */
    this.endedAt = null;

    /**
     * Admin-configurable options that control what players see on their card
     * and how bingo is validated.
     * @type {{ showSongHistory: boolean, showNowPlaying: boolean, showHint: boolean, strictValidation: boolean, freeSpace: boolean, bingoMode: string }}
     */
    this.playerOptions = {
      showSongHistory: true,
      showNowPlaying: true,
      showHint: true,
      strictValidation: true,
      freeSpace: true,
      bingoMode: 'any-line',
    };
  }

  // ─── Card management ──────────────────────────────────────────────────────

  setCards(cards, playlistSongs, playlistId) {
    this.gameId = uuidv4(); // new room per card set
    this.cards = cards;
    this.playlistSongs = playlistSongs;
    this.playlistId = playlistId;
  }

  /**
   * Append a single card (e.g. one generated on-demand when a player joins via
   * QR code) without replacing the existing card set or changing the gameId.
   * @param {Object} card  Card object produced by generateCard().
   */
  addCard(card) {
    this.cards.push(card);
  }

  getCardById(id) {
    return this.cards.find((c) => c.id === id) || null;
  }

  // ─── Game lifecycle ───────────────────────────────────────────────────────

  start() {
    if (this.cards.length === 0) {
      throw new Error('Generate bingo cards before starting the game.');
    }
    this.status = 'active';
    this.startedAt = new Date().toISOString();
    this.playedSongs = [];
    this.playedSongIds = new Set();
    this.winners = [];
    this.currentSong = null;
  }

  end() {
    this.status = 'ended';
    this.endedAt = new Date().toISOString();
    this._addCurrentSongToHistory();
    this.currentSong = null;
  }

  reset() {
    // Preserve cards, gameId, playlist and player options so that existing
    // player links remain valid.  Only wipe game-progress state so the
    // admin can replay the same set of cards without re-sending links.
    this.status = 'idle';
    this.currentSong = null;
    this.playedSongs = [];
    this.playedSongIds = new Set();
    this.winners = [];
    this.startedAt = null;
    this.endedAt = null;
    this.playerOptions.bingoMode = 'any-line';
  }

  // ─── Song tracking ────────────────────────────────────────────────────────

  /**
   * Record the end of the current song to history, then update currentSong to
   * the newly-detected track. History is updated for the song that just
   * finished, not the one that is starting.
   * @param {Object} song  Spotify track object (must have .id).
   */
  recordSong(song) {
    // Add the song that just finished playing to history before switching.
    this._addCurrentSongToHistory();
    this.currentSong = song;
  }

  /**
   * Mark the currently-playing song as finished and clear it.
   * Called when Spotify reports playback has stopped/paused.
   */
  finishCurrentSong() {
    this._addCurrentSongToHistory();
    this.currentSong = null;
  }

  /**
   * Internal helper: push currentSong into playedSongs if not already there.
   */
  _addCurrentSongToHistory() {
    if (this.currentSong && !this.playedSongIds.has(this.currentSong.id)) {
      this.playedSongs.push({ ...this.currentSong, playedAt: new Date().toISOString() });
      this.playedSongIds.add(this.currentSong.id);
    }
  }

  // ─── Player options ───────────────────────────────────────────────────────

  /**
   * Update one or more player-facing display options.
   * Boolean keys are accepted for display flags; `bingoMode` accepts a string.
   * Unknown keys are ignored.
   * @param {{ showSongHistory?: boolean, showNowPlaying?: boolean, showHint?: boolean, strictValidation?: boolean, freeSpace?: boolean, bingoMode?: string }} opts
   */
  setPlayerOptions(opts) {
    const boolKeys = ['showSongHistory', 'showNowPlaying', 'showHint', 'strictValidation', 'freeSpace'];
    for (const key of boolKeys) {
      if (typeof opts[key] === 'boolean') {
        this.playerOptions[key] = opts[key];
      }
    }
    const validModes = ['any-line', 'postage-stamp', 'full-board'];
    if (typeof opts.bingoMode === 'string' && validModes.includes(opts.bingoMode)) {
      this.playerOptions.bingoMode = opts.bingoMode;
    }
  }

  // ─── Bingo claims ─────────────────────────────────────────────────────────

  /**
   * Register a validated bingo claim.
   * @param {Object} claim  { cardId, cardNumber, playerName, pattern, claimedAt }
   * @returns {number}  Rank (1-based position among winners).
   */
  addWinner(claim) {
    this.winners.push(claim);
    // Keep sorted by claimedAt so rank = index + 1.
    this.winners.sort((a, b) => new Date(a.claimedAt) - new Date(b.claimedAt));
    return this.winners.findIndex((w) => w.cardId === claim.cardId) + 1;
  }

  // ─── Serialisable snapshot ────────────────────────────────────────────────

  toJSON() {
    return {
      gameId: this.gameId,
      status: this.status,
      cardCount: this.cards.length,
      playlistId: this.playlistId,
      currentSong: this.currentSong,
      playedSongs: this.playedSongs,
      winners: this.winners,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      playerOptions: { ...this.playerOptions },
    };
  }
}

module.exports = GameState;
