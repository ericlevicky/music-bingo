/**
 * tests/bingo.test.js
 *
 * Unit tests for bingo card generation and validation logic.
 */

'use strict';

const { generateCard, generateCards, validateBingo, shuffle } = require('../src/bingo');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal song object. */
function makeSong(n) {
  return { id: `song-${n}`, name: `Song ${n}`, artists: `Artist ${n}` };
}

/** Create an array of n song objects. */
function makeSongs(n) {
  return Array.from({ length: n }, (_, i) => makeSong(i + 1));
}

// ─── shuffle ───────────────────────────────────────────────────────────────────

describe('shuffle', () => {
  test('returns the same array reference', () => {
    const arr = [1, 2, 3];
    expect(shuffle(arr)).toBe(arr);
  });

  test('preserves all elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle([...arr]);
    expect(shuffled.sort((a, b) => a - b)).toEqual(arr);
  });

  test('shuffles arrays of length 1 without error', () => {
    expect(() => shuffle([42])).not.toThrow();
  });
});

// ─── generateCard ──────────────────────────────────────────────────────────────

describe('generateCard', () => {
  const songs = makeSongs(30);

  test('throws if fewer than 24 songs are provided', () => {
    expect(() => generateCard(makeSongs(23), 1)).toThrow(/at least 24/);
  });

  test('returns a card with id, number, grid, and createdAt', () => {
    const card = generateCard(songs, 1);
    expect(card).toHaveProperty('id');
    expect(card).toHaveProperty('number', 1);
    expect(card).toHaveProperty('grid');
    expect(card).toHaveProperty('createdAt');
  });

  test('grid is 5×5', () => {
    const { grid } = generateCard(songs, 1);
    expect(grid).toHaveLength(5);
    grid.forEach((row) => expect(row).toHaveLength(5));
  });

  test('centre cell (2,2) is the FREE space', () => {
    const { grid } = generateCard(songs, 1);
    expect(grid[2][2].isFree).toBe(true);
    expect(grid[2][2].song).toBeNull();
  });

  test('all non-free cells have a song', () => {
    const { grid } = generateCard(songs, 1);
    grid.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (r === 2 && c === 2) return;
        expect(cell.song).not.toBeNull();
        expect(cell.isFree).toBe(false);
      })
    );
  });

  test('each of the 24 non-free cells has a unique song', () => {
    const { grid } = generateCard(songs, 1);
    const ids = [];
    grid.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (r === 2 && c === 2) return;
        ids.push(cell.song.id);
      })
    );
    expect(new Set(ids).size).toBe(24);
  });

  test('does not mutate the input songs array', () => {
    const songs24 = makeSongs(24);
    const copy = [...songs24];
    generateCard(songs24, 1);
    expect(songs24).toEqual(copy);
  });
});

// ─── generateCards ─────────────────────────────────────────────────────────────

describe('generateCards', () => {
  const songs = makeSongs(30);

  test('generates the requested number of cards', () => {
    expect(generateCards(songs, 5)).toHaveLength(5);
  });

  test('throws for non-positive count', () => {
    expect(() => generateCards(songs, 0)).toThrow(/positive integer/);
    expect(() => generateCards(songs, -1)).toThrow(/positive integer/);
  });

  test('throws for non-integer count', () => {
    expect(() => generateCards(songs, 2.5)).toThrow(/positive integer/);
  });

  test('each card has a unique id', () => {
    const cards = generateCards(songs, 10);
    const ids = cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(10);
  });

  test('card numbers are sequential starting at 1', () => {
    const cards = generateCards(songs, 5);
    expect(cards.map((c) => c.number)).toEqual([1, 2, 3, 4, 5]);
  });
});

// ─── validateBingo ─────────────────────────────────────────────────────────────

describe('validateBingo', () => {
  /**
   * Build a card grid where cell (r,c) contains song id `song-<r*5+c+1>`
   * and centre (2,2) is FREE.
   */
  function makeGrid() {
    const grid = [];
    let idx = 1;
    for (let r = 0; r < 5; r++) {
      const row = [];
      for (let c = 0; c < 5; c++) {
        if (r === 2 && c === 2) {
          row.push({ isFree: true, song: null });
        } else {
          row.push({ isFree: false, song: makeSong(idx++) });
        }
      }
      grid.push(row);
    }
    return grid;
  }

  /** Convert grid positions to song IDs to add to playedSongIds. */
  function songIdAt(grid, r, c) {
    return grid[r][c].song.id;
  }

  test('returns isValid:false for an empty marked set', () => {
    const grid = makeGrid();
    const { isValid } = validateBingo(grid, new Set(), []);
    expect(isValid).toBe(false);
  });

  test('validates a complete row (row 0)', () => {
    const grid = makeGrid();
    const playedIds = new Set(
      [0, 1, 2, 3, 4].map((c) => songIdAt(grid, 0, c))
    );
    const marked = [0, 1, 2, 3, 4].map((c) => ({ row: 0, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(true);
    expect(pattern).toBe('row-0');
  });

  test('validates a complete column (col 0)', () => {
    const grid = makeGrid();
    const playedIds = new Set(
      [0, 1, 3, 4].map((r) => songIdAt(grid, r, 0)) // row 2 col 0 is not free
    );
    // Also add col-0 row-2 song
    playedIds.add(songIdAt(grid, 2, 0));
    const marked = [0, 1, 2, 3, 4].map((r) => ({ row: r, col: 0 }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(true);
    expect(pattern).toBe('col-0');
  });

  test('validates the top-left to bottom-right diagonal (includes FREE)', () => {
    const grid = makeGrid();
    // Diagonal: (0,0),(1,1),(2,2)FREE,(3,3),(4,4)
    const playedIds = new Set([
      songIdAt(grid, 0, 0),
      songIdAt(grid, 1, 1),
      songIdAt(grid, 3, 3),
      songIdAt(grid, 4, 4),
    ]);
    const marked = [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 3, col: 3 },
      { row: 4, col: 4 },
    ];
    const { isValid, pattern } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(true);
    expect(pattern).toBe('diagonal-tl-br');
  });

  test('validates the top-right to bottom-left diagonal (includes FREE)', () => {
    const grid = makeGrid();
    const playedIds = new Set([
      songIdAt(grid, 0, 4),
      songIdAt(grid, 1, 3),
      songIdAt(grid, 3, 1),
      songIdAt(grid, 4, 0),
    ]);
    const marked = [
      { row: 0, col: 4 },
      { row: 1, col: 3 },
      { row: 3, col: 1 },
      { row: 4, col: 0 },
    ];
    const { isValid, pattern } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(true);
    expect(pattern).toBe('diagonal-tr-bl');
  });

  test('rejects bingo if a marked cell song was not played', () => {
    const grid = makeGrid();
    // Mark an entire row but only 4 of the 5 songs have been played
    const playedIds = new Set(
      [1, 2, 3, 4].map((c) => songIdAt(grid, 0, c)) // col 0 NOT played
    );
    const marked = [0, 1, 2, 3, 4].map((c) => ({ row: 0, col: c }));
    const { isValid } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(false);
  });

  test('rejects bingo if cells are marked but pattern is incomplete', () => {
    const grid = makeGrid();
    const playedIds = new Set([songIdAt(grid, 0, 0), songIdAt(grid, 0, 1)]);
    const marked = [{ row: 0, col: 0 }, { row: 0, col: 1 }];
    const { isValid } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(false);
  });

  test('row with FREE space at centre counts FREE cell correctly', () => {
    // Row 2 contains the FREE cell at col 2
    const grid = makeGrid();
    const playedIds = new Set(
      [0, 1, 3, 4].map((c) => songIdAt(grid, 2, c))
    );
    const marked = [0, 1, 3, 4].map((c) => ({ row: 2, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(true);
    expect(pattern).toBe('row-2');
  });
});
