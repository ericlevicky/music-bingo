/**
 * tests/bingo.test.js
 *
 * Unit tests for bingo card generation and validation logic.
 */

'use strict';

const { generateCard, generateCards, generateGrid, validateBingo, shuffle, detectContactType } = require('../src/bingo');

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

  test('throws if fewer than 25 songs are provided', () => {
    expect(() => generateCard(makeSongs(24), 1)).toThrow(/at least 25/);
  });

  test('returns a card with id, number, contact, grid, and createdAt', () => {
    const card = generateCard(songs, 1);
    expect(card).toHaveProperty('id');
    expect(card).toHaveProperty('number', 1);
    expect(card).toHaveProperty('contact', null);
    expect(card).toHaveProperty('grid');
    expect(card).toHaveProperty('createdAt');
  });

  test('stores the provided contact on the card', () => {
    const contact = { type: 'email', value: 'test@example.com' };
    const card = generateCard(songs, 1, contact);
    expect(card.contact).toEqual(contact);
  });

  test('grid is 5×5', () => {
    const { grid } = generateCard(songs, 1);
    expect(grid).toHaveLength(5);
    grid.forEach((row) => expect(row).toHaveLength(5));
  });

  test('centre cell (2,2) is the FREE space and has a song assigned', () => {
    const { grid } = generateCard(songs, 1);
    expect(grid[2][2].isFree).toBe(true);
    expect(grid[2][2].song).not.toBeNull();
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

  test('the FREE centre cell also has a song assigned', () => {
    const { grid } = generateCard(songs, 1);
    expect(grid[2][2].song).not.toBeNull();
  });

  test('each of the 25 cells has a unique song', () => {
    const { grid } = generateCard(songs, 1);
    const ids = [];
    grid.forEach((row) =>
      row.forEach((cell) => {
        ids.push(cell.song.id);
      })
    );
    expect(new Set(ids).size).toBe(25);
  });

  test('does not mutate the input songs array', () => {
    const songs25 = makeSongs(25);
    const copy = [...songs25];
    generateCard(songs25, 1);
    expect(songs25).toEqual(copy);
  });
});

// ─── generateGrid ───────────────────────────────────────────────────────────────

describe('generateGrid', () => {
  const songs = makeSongs(30);

  test('throws if fewer than 25 songs are provided', () => {
    expect(() => generateGrid(makeSongs(24))).toThrow(/at least 25/);
  });

  test('returns a 5×5 grid', () => {
    const grid = generateGrid(songs);
    expect(grid).toHaveLength(5);
    grid.forEach((row) => expect(row).toHaveLength(5));
  });

  test('centre cell (2,2) is the FREE space and has a song assigned', () => {
    const grid = generateGrid(songs);
    expect(grid[2][2].isFree).toBe(true);
    expect(grid[2][2].song).not.toBeNull();
  });

  test('each of the 25 cells has a unique song', () => {
    const grid = generateGrid(songs);
    const ids = [];
    grid.forEach((row) => row.forEach((cell) => ids.push(cell.song.id)));
    expect(new Set(ids).size).toBe(25);
  });

  test('does not mutate the input songs array', () => {
    const songs25 = makeSongs(25);
    const copy = [...songs25];
    generateGrid(songs25);
    expect(songs25).toEqual(copy);
  });

  test('successive calls produce different grids (not always identical)', () => {
    // With 30 songs and random shuffle the odds of two identical grids are
    // astronomically small; this guards against a broken (non-random) impl.
    const grid1 = generateGrid(songs);
    const grid2 = generateGrid(songs);
    const ids1 = grid1.flat().map((c) => c.song.id).join(',');
    const ids2 = grid2.flat().map((c) => c.song.id).join(',');
    // It is theoretically possible they are equal, but practically never.
    // We run 5 pairs and expect at least one difference.
    const anyDiff = Array.from({ length: 5 }).some(() => {
      const a = generateGrid(songs).flat().map((c) => c.song.id).join(',');
      const b = generateGrid(songs).flat().map((c) => c.song.id).join(',');
      return a !== b;
    });
    expect(anyDiff).toBe(true);
  });
});

// ─── generateCards ─────────────────────────────────────────────────────────────

describe('generateCards – count overload', () => {
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

  test('cards have null contact when generated by count', () => {
    const cards = generateCards(songs, 3);
    cards.forEach((c) => expect(c.contact).toBeNull());
  });
});

describe('generateCards – contacts overload', () => {
  const songs = makeSongs(30);

  test('throws for empty contacts array', () => {
    expect(() => generateCards(songs, [])).toThrow(/non-empty array/);
  });

  test('generates one card per contact when count is omitted', () => {
    const contacts = [
      { value: 'a@example.com' },
      { value: 'b@example.com' },
    ];
    const cards = generateCards(songs, contacts);
    expect(cards).toHaveLength(2);
  });

  test('generates multiple cards per contact when count is specified', () => {
    const contacts = [
      { value: 'a@example.com', count: 3 },
      { value: '+15550001234', count: 2 },
    ];
    const cards = generateCards(songs, contacts);
    expect(cards).toHaveLength(5);
  });

  test('assigns the correct contact to each card', () => {
    const contacts = [
      { value: 'alice@example.com', count: 2 },
      { value: '+15550001234', count: 1 },
    ];
    const cards = generateCards(songs, contacts);
    expect(cards[0].contact.value).toBe('alice@example.com');
    expect(cards[1].contact.value).toBe('alice@example.com');
    expect(cards[2].contact.value).toBe('+15550001234');
  });

  test('card numbers are sequential across all contacts', () => {
    const contacts = [
      { value: 'a@example.com', count: 2 },
      { value: 'b@example.com', count: 2 },
    ];
    const cards = generateCards(songs, contacts);
    expect(cards.map((c) => c.number)).toEqual([1, 2, 3, 4]);
  });

  test('each card has a unique id', () => {
    const contacts = [{ value: 'x@example.com', count: 5 }];
    const cards = generateCards(songs, contacts);
    expect(new Set(cards.map((c) => c.id)).size).toBe(5);
  });
});

// ─── detectContactType ────────────────────────────────────────────────────────

describe('detectContactType', () => {
  test('detects email addresses', () => {
    expect(detectContactType('user@example.com')).toBe('email');
    expect(detectContactType('user+tag@sub.domain.org')).toBe('email');
  });

  test('detects phone numbers', () => {
    expect(detectContactType('+1 555 000 1234')).toBe('phone');
    expect(detectContactType('+447911123456')).toBe('phone');
  });

  test('returns other for unrecognised values', () => {
    expect(detectContactType('John Smith')).toBe('other');
    expect(detectContactType('')).toBe('other');
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
          // Free cell always has a song (like the real generateCard)
          row.push({ isFree: true, song: makeSong(25) });
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
      [0, 1, 2, 3, 4].map((r) => songIdAt(grid, r, 0))
    );
    const marked = [0, 1, 2, 3, 4].map((r) => ({ row: r, col: 0 }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(true);
    expect(pattern).toBe('col-0');
  });

  test('validates the top-left to bottom-right diagonal (includes FREE)', () => {
    const grid = makeGrid();
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
    const grid = makeGrid();
    const playedIds = new Set(
      [0, 1, 3, 4].map((c) => songIdAt(grid, 2, c))
    );
    const marked = [0, 1, 3, 4].map((c) => ({ row: 2, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked);
    expect(isValid).toBe(true);
    expect(pattern).toBe('row-2');
  });

  test('currently-playing song counts as valid even if not yet in playedSongIds', () => {
    const grid = makeGrid();
    // Row 0: songs at cols 0–4; only cols 1–4 are in playedIds; col 0 is currently playing
    const playedIds = new Set([1, 2, 3, 4].map((c) => songIdAt(grid, 0, c)));
    const currentSongId = songIdAt(grid, 0, 0);
    const marked = [0, 1, 2, 3, 4].map((c) => ({ row: 0, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, currentSongId);
    expect(isValid).toBe(true);
    expect(pattern).toBe('row-0');
  });

  test('currently-playing song does not validate an unmarked cell', () => {
    const grid = makeGrid();
    const playedIds = new Set([1, 2, 3, 4].map((c) => songIdAt(grid, 0, c)));
    const currentSongId = songIdAt(grid, 0, 0);
    // col 0 is NOT marked even though it is currently playing
    const marked = [1, 2, 3, 4].map((c) => ({ row: 0, col: c }));
    const { isValid } = validateBingo(grid, playedIds, marked, currentSongId);
    expect(isValid).toBe(false);
  });

  test('freeSpace:false does not auto-validate the centre cell', () => {
    const grid = makeGrid();
    // Row 2 minus centre: mark and play all 4 non-free cells
    const playedIds = new Set([0, 1, 3, 4].map((c) => songIdAt(grid, 2, c)));
    const marked = [0, 1, 3, 4].map((c) => ({ row: 2, col: c }));
    const { isValid } = validateBingo(grid, playedIds, marked, null, false);
    expect(isValid).toBe(false);
  });

  test('freeSpace:false validates centre cell when its song is played and marked', () => {
    const grid = makeGrid();
    // Row 2: play and mark all 5 cells including the free space song
    const playedIds = new Set([
      ...([0, 1, 3, 4].map((c) => songIdAt(grid, 2, c))),
      grid[2][2].song.id,
    ]);
    const marked = [0, 1, 2, 3, 4].map((c) => ({ row: 2, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, false);
    expect(isValid).toBe(true);
    expect(pattern).toBe('row-2');
  });

  test('freeSpace:true (default) auto-validates the centre cell', () => {
    const grid = makeGrid();
    const playedIds = new Set([0, 1, 3, 4].map((c) => songIdAt(grid, 2, c)));
    const marked = [0, 1, 3, 4].map((c) => ({ row: 2, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, true);
    expect(isValid).toBe(true);
    expect(pattern).toBe('row-2');
  });
});

// ─── validateBingo – postage-stamp mode ────────────────────────────────────────

describe('validateBingo – postage-stamp mode', () => {
  function makeGrid() {
    const grid = [];
    let idx = 1;
    for (let r = 0; r < 5; r++) {
      const row = [];
      for (let c = 0; c < 5; c++) {
        if (r === 2 && c === 2) {
          row.push({ isFree: true, song: makeSong(25) });
        } else {
          row.push({ isFree: false, song: makeSong(idx++) });
        }
      }
      grid.push(row);
    }
    return grid;
  }

  function songIdAt(grid, r, c) { return grid[r][c].song.id; }

  test('validates top-left corner (postage-stamp-tl)', () => {
    const grid = makeGrid();
    const corners = [[0,0],[0,1],[1,0],[1,1]];
    const playedIds = new Set(corners.map(([r, c]) => songIdAt(grid, r, c)));
    const marked = corners.map(([r, c]) => ({ row: r, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, true, 'postage-stamp');
    expect(isValid).toBe(true);
    expect(pattern).toBe('postage-stamp-tl');
  });

  test('validates top-right corner (postage-stamp-tr)', () => {
    const grid = makeGrid();
    const corners = [[0,3],[0,4],[1,3],[1,4]];
    const playedIds = new Set(corners.map(([r, c]) => songIdAt(grid, r, c)));
    const marked = corners.map(([r, c]) => ({ row: r, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, true, 'postage-stamp');
    expect(isValid).toBe(true);
    expect(pattern).toBe('postage-stamp-tr');
  });

  test('validates bottom-left corner (postage-stamp-bl)', () => {
    const grid = makeGrid();
    const corners = [[3,0],[3,1],[4,0],[4,1]];
    const playedIds = new Set(corners.map(([r, c]) => songIdAt(grid, r, c)));
    const marked = corners.map(([r, c]) => ({ row: r, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, true, 'postage-stamp');
    expect(isValid).toBe(true);
    expect(pattern).toBe('postage-stamp-bl');
  });

  test('validates bottom-right corner (postage-stamp-br)', () => {
    const grid = makeGrid();
    const corners = [[3,3],[3,4],[4,3],[4,4]];
    const playedIds = new Set(corners.map(([r, c]) => songIdAt(grid, r, c)));
    const marked = corners.map(([r, c]) => ({ row: r, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, true, 'postage-stamp');
    expect(isValid).toBe(true);
    expect(pattern).toBe('postage-stamp-br');
  });

  test('rejects a full row in postage-stamp mode', () => {
    const grid = makeGrid();
    const playedIds = new Set([0,1,2,3,4].map((c) => songIdAt(grid, 0, c)));
    const marked = [0,1,2,3,4].map((c) => ({ row: 0, col: c }));
    const { isValid } = validateBingo(grid, playedIds, marked, null, true, 'postage-stamp');
    expect(isValid).toBe(false);
  });

  test('rejects an incomplete corner in postage-stamp mode', () => {
    const grid = makeGrid();
    // Only 3 of 4 top-left corner cells are played/marked
    const playedIds = new Set([[0,0],[0,1],[1,0]].map(([r,c]) => songIdAt(grid, r, c)));
    const marked = [[0,0],[0,1],[1,0]].map(([r,c]) => ({ row: r, col: c }));
    const { isValid } = validateBingo(grid, playedIds, marked, null, true, 'postage-stamp');
    expect(isValid).toBe(false);
  });
});

// ─── validateBingo – full-board mode ───────────────────────────────────────────

describe('validateBingo – full-board mode', () => {
  function makeGrid() {
    const grid = [];
    let idx = 1;
    for (let r = 0; r < 5; r++) {
      const row = [];
      for (let c = 0; c < 5; c++) {
        if (r === 2 && c === 2) {
          row.push({ isFree: true, song: makeSong(25) });
        } else {
          row.push({ isFree: false, song: makeSong(idx++) });
        }
      }
      grid.push(row);
    }
    return grid;
  }

  function songIdAt(grid, r, c) { return grid[r][c].song.id; }

  /** Mark and play every non-free cell; the free cell is auto-valid. */
  function allPlayedAndMarked(grid) {
    const playedIds = new Set();
    const marked = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (!(r === 2 && c === 2)) {
          playedIds.add(songIdAt(grid, r, c));
          marked.push({ row: r, col: c });
        }
      }
    }
    return { playedIds, marked };
  }

  test('validates a completely marked board', () => {
    const grid = makeGrid();
    const { playedIds, marked } = allPlayedAndMarked(grid);
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, true, 'full-board');
    expect(isValid).toBe(true);
    expect(pattern).toBe('full-board');
  });

  test('rejects a board with one cell missing', () => {
    const grid = makeGrid();
    const { playedIds, marked } = allPlayedAndMarked(grid);
    // Remove one cell from marked
    marked.pop();
    const { isValid } = validateBingo(grid, playedIds, marked, null, true, 'full-board');
    expect(isValid).toBe(false);
  });

  test('rejects a single complete row in full-board mode', () => {
    const grid = makeGrid();
    const playedIds = new Set([0,1,2,3,4].map((c) => songIdAt(grid, 0, c)));
    const marked = [0,1,2,3,4].map((c) => ({ row: 0, col: c }));
    const { isValid } = validateBingo(grid, playedIds, marked, null, true, 'full-board');
    expect(isValid).toBe(false);
  });
});

// ─── validateBingo – x-pattern mode ───────────────────────────────────────────

describe('validateBingo – x-pattern mode', () => {
  function makeGrid() {
    const grid = [];
    let idx = 1;
    for (let r = 0; r < 5; r++) {
      const row = [];
      for (let c = 0; c < 5; c++) {
        if (r === 2 && c === 2) {
          row.push({ isFree: true, song: makeSong(25) });
        } else {
          row.push({ isFree: false, song: makeSong(idx++) });
        }
      }
      grid.push(row);
    }
    return grid;
  }

  function songIdAt(grid, r, c) { return grid[r][c].song.id; }

  /** Cells in both diagonals (9 unique cells – centre is shared). */
  const DIAG_CELLS = [
    [0,0],[1,1],[2,2],[3,3],[4,4],
    [0,4],[1,3],[3,1],[4,0],
  ];

  test('validates both diagonals as an X', () => {
    const grid = makeGrid();
    const nonFreeDiag = DIAG_CELLS.filter(([r, c]) => !(r === 2 && c === 2));
    const playedIds = new Set(nonFreeDiag.map(([r, c]) => songIdAt(grid, r, c)));
    const marked = nonFreeDiag.map(([r, c]) => ({ row: r, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, true, 'x-pattern');
    expect(isValid).toBe(true);
    expect(pattern).toBe('x-pattern');
  });

  test('rejects when only one diagonal is complete', () => {
    const grid = makeGrid();
    // Only top-left → bottom-right diagonal
    const cells = [[0,0],[1,1],[2,2],[3,3],[4,4]];
    const nonFree = cells.filter(([r, c]) => !(r === 2 && c === 2));
    const playedIds = new Set(nonFree.map(([r, c]) => songIdAt(grid, r, c)));
    const marked = nonFree.map(([r, c]) => ({ row: r, col: c }));
    const { isValid } = validateBingo(grid, playedIds, marked, null, true, 'x-pattern');
    expect(isValid).toBe(false);
  });

  test('rejects a full row in x-pattern mode', () => {
    const grid = makeGrid();
    const playedIds = new Set([0,1,2,3,4].map((c) => songIdAt(grid, 0, c)));
    const marked = [0,1,2,3,4].map((c) => ({ row: 0, col: c }));
    const { isValid } = validateBingo(grid, playedIds, marked, null, true, 'x-pattern');
    expect(isValid).toBe(false);
  });

  test('requires all 9 distinct diagonal cells to be played (with freeSpace:false)', () => {
    const grid = makeGrid();
    // Play all 9 diagonal cells including centre
    const playedIds = new Set(DIAG_CELLS.map(([r, c]) => songIdAt(grid, r, c)));
    const marked = DIAG_CELLS.map(([r, c]) => ({ row: r, col: c }));
    const { isValid, pattern } = validateBingo(grid, playedIds, marked, null, false, 'x-pattern');
    expect(isValid).toBe(true);
    expect(pattern).toBe('x-pattern');
  });
});
