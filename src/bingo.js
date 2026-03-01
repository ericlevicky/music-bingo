/**
 * bingo.js – Card generation and validation logic.
 *
 * A standard Music Bingo card is a 5×5 grid.
 * The centre cell (row 2, col 2) is always a FREE space.
 * Each of the remaining 24 cells holds a unique song chosen at random from
 * the supplied playlist.
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
 * @param {Array<Object>} songs  Full song list (≥ 24 items).
 * @param {number}        number Human-readable card number (1-based).
 * @returns {Object}  Card object.
 */
function generateCard(songs, number) {
  if (songs.length < 24) {
    throw new Error('Playlist must contain at least 24 songs to generate a bingo card.');
  }

  // Pick 24 unique songs for this card.
  const pool = shuffle([...songs]);
  const selected = pool.slice(0, 24);

  const grid = [];
  let songIdx = 0;

  for (let row = 0; row < 5; row++) {
    const rowCells = [];
    for (let col = 0; col < 5; col++) {
      if (row === 2 && col === 2) {
        // Centre FREE space
        rowCells.push({ isFree: true, song: null });
      } else {
        rowCells.push({ isFree: false, song: selected[songIdx++] });
      }
    }
    grid.push(rowCells);
  }

  return {
    id: uuidv4(),
    number,
    grid,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generate `count` bingo cards from a song pool.
 * @param {Array<Object>} songs
 * @param {number}        count  Number of cards to generate.
 * @returns {Array<Object>}
 */
function generateCards(songs, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('count must be a positive integer.');
  }
  const cards = [];
  for (let i = 0; i < count; i++) {
    cards.push(generateCard(songs, i + 1));
  }
  return cards;
}

// ─── Bingo validation ────────────────────────────────────────────────────────

/**
 * Check whether a set of marked cells forms a valid bingo on the given card.
 *
 * Validation rules:
 *  1. A cell may only be counted if the song in that cell has actually been
 *     played (its Spotify track ID appears in `playedSongIds`).
 *  2. The FREE centre cell is always valid.
 *  3. A valid bingo is any complete row, column, or diagonal.
 *
 * @param {Array<Array<Object>>} grid         5×5 card grid.
 * @param {Set<string>}          playedSongIds Set of played Spotify track IDs.
 * @param {Array<{row:number, col:number}>} markedCells Cells the player marked.
 * @returns {{ isValid: boolean, pattern: string|null }}
 */
function validateBingo(grid, playedSongIds, markedCells) {
  // Build a quick lookup for player-marked cells.
  const markedSet = new Set(markedCells.map(({ row, col }) => `${row},${col}`));

  // Build a 5×5 boolean matrix of *validly* marked cells.
  const valid = Array.from({ length: 5 }, () => Array(5).fill(false));

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = grid[r][c];
      if (cell.isFree) {
        valid[r][c] = true;
      } else if (
        cell.song &&
        playedSongIds.has(cell.song.id) &&
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

module.exports = { generateCard, generateCards, validateBingo, shuffle };
