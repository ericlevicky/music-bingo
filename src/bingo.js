/**
 * bingo.js – Card generation and validation logic.
 *
 * A standard Music Bingo card is a 5×5 grid.
 * The centre cell (row 2, col 2) is the FREE space (it always has isFree: true
 * and is pre-assigned a song so that it becomes a regular markable cell when
 * the admin disables the free space option).
 * Each of the 25 cells holds a unique song chosen at random from the supplied
 * playlist.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

// ─── Card generation ────────────────────────────────────────────────────────

/**
 * Shuffle an array in-place using Fisher-Yates and return it.
 * @param {Array} arr
 * @returns {Array}
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build a single 5×5 bingo card from a pool of songs.
 * @param {Array<Object>} songs   Full song list (≥ 25 items).
 * @param {number}        number  Human-readable card number (1-based).
 * @param {{ type: string, value: string }|null} contact  Assigned contact (email or phone) or null.
 * @returns {Object}  Card object.
 */
function generateCard(songs, number, contact = null) {
  if (songs.length < 25) {
    throw new Error('Playlist must contain at least 25 songs to generate a bingo card.');
  }

  // Pick 25 unique songs for this card (24 for the grid + 1 for the FREE space).
  const pool = shuffle([...songs]);
  const selected = pool.slice(0, 25);

  const grid = [];
  let songIdx = 0;

  for (let row = 0; row < 5; row++) {
    const rowCells = [];
    for (let col = 0; col < 5; col++) {
      if (row === 2 && col === 2) {
        // Centre FREE space – always assign a real song so that if the admin
        // disables the free space option the cell becomes a regular markable cell.
        rowCells.push({ isFree: true, song: selected[24] });
      } else {
        rowCells.push({ isFree: false, song: selected[songIdx++] });
      }
    }
    grid.push(rowCells);
  }

  return {
    id: uuidv4(),
    number,
    contact,  // { type: 'email'|'phone'|'other', value: string } | null
    grid,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generate bingo cards.
 *
 * Two calling conventions:
 *   generateCards(songs, count)            → `count` cards with no contact assigned.
 *   generateCards(songs, contacts)         → one or more cards per contact entry.
 *
 * `contacts` is an array of `{ value: string, count?: number }` objects where
 * `value` is an email address or phone number and `count` defaults to 1.
 *
 * @param {Array<Object>} songs
 * @param {number|Array<{ value: string, count?: number }>} countOrContacts
 * @returns {Array<Object>}
 */
function generateCards(songs, countOrContacts) {
  if (typeof countOrContacts === 'number') {
    const count = countOrContacts;
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('count must be a positive integer.');
    }
    return Array.from({ length: count }, (_, i) =>
      generateCard(songs, i + 1, null)
    );
  }

  if (!Array.isArray(countOrContacts) || countOrContacts.length === 0) {
    throw new Error('contacts must be a non-empty array.');
  }

  const cards = [];
  let cardNumber = 1;

  for (const entry of countOrContacts) {
    const perContact = entry.count && Number.isInteger(entry.count) && entry.count > 0
      ? entry.count
      : 1;
    const contact = { type: detectContactType(entry.value), value: entry.value };

    for (let i = 0; i < perContact; i++) {
      cards.push(generateCard(songs, cardNumber++, contact));
    }
  }

  return cards;
}

/**
 * Detect whether a string looks like an email address, phone number, or other.
 * Phone numbers must contain at least 7 digits and may include +, spaces, dashes,
 * dots, and parentheses (common international formats).
 * @param {string} value
 * @returns {'email'|'phone'|'other'}
 */
function detectContactType(value) {
  if (!value || typeof value !== 'string') return 'other';
  const trimmed = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email';
  // Must have at least 7 digits and only contain valid phone characters
  if (/^[+\d][\d\s\-().]{5,19}$/.test(trimmed) && (trimmed.match(/\d/g) || []).length >= 7) return 'phone';
  return 'other';
}

// ─── Bingo validation ────────────────────────────────────────────────────────

/**
 * Check whether a set of marked cells forms a valid bingo on the given card.
 *
 * Validation rules:
 *  1. A cell may only be counted if the song in that cell has actually been
 *     played (its Spotify track ID appears in `playedSongIds`) OR is the
 *     currently-playing track (`currentSongId`).
 *  2. The FREE centre cell is always valid when `freeSpace` is true.
 *  3. A valid bingo is any complete row, column, or diagonal.
 *
 * @param {Array<Array<Object>>} grid         5×5 card grid.
 * @param {Set<string>}          playedSongIds Set of played Spotify track IDs.
 * @param {Array<{row:number, col:number}>} markedCells Cells the player marked.
 * @param {string|null} [currentSongId]  ID of the currently-playing track (counts as played).
 * @param {boolean}     [freeSpace=true] Whether the centre FREE cell is automatically valid.
 * @returns {{ isValid: boolean, pattern: string|null }}
 */
function validateBingo(grid, playedSongIds, markedCells, currentSongId = null, freeSpace = true) {
  // Build a quick lookup for player-marked cells.
  const markedSet = new Set(markedCells.map(({ row, col }) => `${row},${col}`));

  // Build a 5×5 boolean matrix of *validly* marked cells.
  const valid = Array.from({ length: 5 }, () => Array(5).fill(false));

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = grid[r][c];
      if (cell.isFree && freeSpace) {
        valid[r][c] = true;
      } else if (
        cell.song &&
        (playedSongIds.has(cell.song.id) || cell.song.id === currentSongId) &&
        markedSet.has(`${r},${c}`)
      ) {
        valid[r][c] = true;
      }
    }
  }

  // Check rows
  for (let r = 0; r < 5; r++) {
    if (valid[r].every(Boolean)) {
      return { isValid: true, pattern: `row-${r}` };
    }
  }

  // Check columns
  for (let c = 0; c < 5; c++) {
    if (valid.every((row) => row[c])) {
      return { isValid: true, pattern: `col-${c}` };
    }
  }

  // Check top-left → bottom-right diagonal
  if ([0, 1, 2, 3, 4].every((i) => valid[i][i])) {
    return { isValid: true, pattern: 'diagonal-tl-br' };
  }

  // Check top-right → bottom-left diagonal
  if ([0, 1, 2, 3, 4].every((i) => valid[i][4 - i])) {
    return { isValid: true, pattern: 'diagonal-tr-bl' };
  }

  return { isValid: false, pattern: null };
}

module.exports = { generateCard, generateCards, validateBingo, shuffle, detectContactType };
