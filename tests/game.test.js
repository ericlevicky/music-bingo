/**
 * tests/game.test.js
 *
 * Unit tests for GameState class.
 */

'use strict';

const GameState = require('../src/game');

function makeSong(n) {
  return { id: `song-${n}`, name: `Song ${n}`, artists: `Artist ${n}` };
}

function makeSongs(n) {
  return Array.from({ length: n }, (_, i) => makeSong(i + 1));
}

function makeCards(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `card-${i}`, number: i + 1 }));
}

describe('GameState.end()', () => {
  test('sets status to ended', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();
    game.end();
    expect(game.status).toBe('ended');
  });

  test('sets endedAt timestamp', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();
    game.end();
    expect(game.endedAt).not.toBeNull();
    expect(typeof game.endedAt).toBe('string');
  });

  test('clears currentSong so toJSON does not expose a stale now-playing track', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();

    // Simulate a song playing
    game.recordSong(makeSong(1));
    expect(game.currentSong).not.toBeNull();

    game.end();
    expect(game.currentSong).toBeNull();
    expect(game.toJSON().currentSong).toBeNull();
  });
});
