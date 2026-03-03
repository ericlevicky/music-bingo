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

  test('adds currently-playing song to history when game ends', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();

    game.recordSong(makeSong(1));
    // Song 1 is now playing but not yet in history
    expect(game.playedSongs).toHaveLength(0);

    game.end();
    // Song 1 should now be in history because the game ended
    expect(game.playedSongs).toHaveLength(1);
    expect(game.playedSongs[0].id).toBe('song-1');
  });
});

describe('GameState.setPlayerOptions()', () => {
  test('sets freeSpace option', () => {
    const game = new GameState();
    expect(game.playerOptions.freeSpace).toBe(true);
    game.setPlayerOptions({ freeSpace: false });
    expect(game.playerOptions.freeSpace).toBe(false);
  });

  test('restores freeSpace via reset', () => {
    const game = new GameState();
    game.setPlayerOptions({ freeSpace: false });
    game.reset();
    expect(game.playerOptions.freeSpace).toBe(true);
  });

  test('defaults bingoMode to any-line', () => {
    const game = new GameState();
    expect(game.playerOptions.bingoMode).toBe('any-line');
  });

  test('sets bingoMode to postage-stamp', () => {
    const game = new GameState();
    game.setPlayerOptions({ bingoMode: 'postage-stamp' });
    expect(game.playerOptions.bingoMode).toBe('postage-stamp');
  });

  test('sets bingoMode to full-board', () => {
    const game = new GameState();
    game.setPlayerOptions({ bingoMode: 'full-board' });
    expect(game.playerOptions.bingoMode).toBe('full-board');
  });

  test('ignores unknown bingoMode values', () => {
    const game = new GameState();
    game.setPlayerOptions({ bingoMode: 'invalid-mode' });
    expect(game.playerOptions.bingoMode).toBe('any-line');
  });

  test('restores bingoMode to any-line via reset', () => {
    const game = new GameState();
    game.setPlayerOptions({ bingoMode: 'full-board' });
    game.reset();
    expect(game.playerOptions.bingoMode).toBe('any-line');
  });
});

describe('GameState song history', () => {
  test('song is NOT added to history immediately when it starts playing', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();

    game.recordSong(makeSong(1));
    expect(game.playedSongs).toHaveLength(0);
    expect(game.currentSong.id).toBe('song-1');
  });

  test('previous song is added to history when the next song starts', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();

    game.recordSong(makeSong(1));
    expect(game.playedSongs).toHaveLength(0);

    game.recordSong(makeSong(2));
    // Song 1 should now be in history, song 2 should be current
    expect(game.playedSongs).toHaveLength(1);
    expect(game.playedSongs[0].id).toBe('song-1');
    expect(game.currentSong.id).toBe('song-2');
  });

  test('finishCurrentSong adds current song to history and clears currentSong', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();

    game.recordSong(makeSong(1));
    expect(game.playedSongs).toHaveLength(0);

    game.finishCurrentSong();
    expect(game.playedSongs).toHaveLength(1);
    expect(game.playedSongs[0].id).toBe('song-1');
    expect(game.currentSong).toBeNull();
  });

  test('duplicate songs are not added to history twice', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();

    game.recordSong(makeSong(1));
    game.recordSong(makeSong(2)); // song-1 goes to history
    game.recordSong(makeSong(1)); // song-2 goes to history, song-1 already there
    game.finishCurrentSong();     // song-1 (duplicate) would not be re-added

    const ids = game.playedSongs.map((s) => s.id);
    expect(ids.filter((id) => id === 'song-1')).toHaveLength(1);
    expect(ids.filter((id) => id === 'song-2')).toHaveLength(1);
    expect(game.playedSongs).toHaveLength(2);
  });

  test('finishCurrentSong is a no-op when nothing is playing', () => {
    const game = new GameState();
    game.setCards(makeCards(2), makeSongs(24), 'playlist-1');
    game.start();

    game.finishCurrentSong(); // nothing playing yet
    expect(game.playedSongs).toHaveLength(0);
    expect(game.currentSong).toBeNull();
  });
});
