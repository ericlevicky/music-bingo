/**
 * tests/store.test.js
 *
 * Unit tests for the AdminStore class (src/store.js).
 * We require the module fresh for each test suite using jest.isolateModules
 * to avoid shared state between tests.
 */

'use strict';

function makeProfile(overrides = {}) {
  return {
    googleId: 'google-123',
    email:    'admin@example.com',
    name:     'Test Admin',
    picture:  'https://example.com/pic.jpg',
    ...overrides,
  };
}

describe('AdminStore.getOrCreate()', () => {
  let store;

  beforeEach(() => {
    jest.isolateModules(() => {
      store = require('../src/store');
    });
  });

  test('creates a new AdminData when the googleId is not yet known', () => {
    const profile = makeProfile();
    const admin = store.getOrCreate(profile.googleId, profile);

    expect(admin).not.toBeNull();
    expect(admin.googleId).toBe(profile.googleId);
    expect(admin.name).toBe(profile.name);
    expect(admin.email).toBe(profile.email);
    expect(admin.picture).toBe(profile.picture);
  });

  test('returns the same AdminData object on a second call with the same googleId', () => {
    const profile = makeProfile();
    const first  = store.getOrCreate(profile.googleId, profile);
    const second = store.getOrCreate(profile.googleId, profile);

    expect(second).toBe(first);
  });

  test('refreshes name from Google on subsequent login (same server session)', () => {
    const profile = makeProfile({ name: 'Old Name' });
    store.getOrCreate(profile.googleId, profile);

    const updatedProfile = makeProfile({ name: 'New Name From Google' });
    const admin = store.getOrCreate(profile.googleId, updatedProfile);

    expect(admin.name).toBe('New Name From Google');
  });

  test('refreshes email from Google on subsequent login', () => {
    const profile = makeProfile({ email: 'old@example.com' });
    store.getOrCreate(profile.googleId, profile);

    const updatedProfile = makeProfile({ email: 'new@example.com' });
    const admin = store.getOrCreate(profile.googleId, updatedProfile);

    expect(admin.email).toBe('new@example.com');
  });

  test('refreshes picture from Google on subsequent login', () => {
    const profile = makeProfile({ picture: 'https://example.com/old.jpg' });
    store.getOrCreate(profile.googleId, profile);

    const updatedProfile = makeProfile({ picture: 'https://example.com/new.jpg' });
    const admin = store.getOrCreate(profile.googleId, updatedProfile);

    expect(admin.picture).toBe('https://example.com/new.jpg');
  });

  test('sets picture to null when Google returns no photo', () => {
    const profile = makeProfile({ picture: 'https://example.com/pic.jpg' });
    store.getOrCreate(profile.googleId, profile);

    const updatedProfile = makeProfile({ picture: null });
    const admin = store.getOrCreate(profile.googleId, updatedProfile);

    expect(admin.picture).toBeNull();
  });

  test('preserves game state when profile is refreshed on subsequent login', () => {
    const profile = makeProfile();
    const admin = store.getOrCreate(profile.googleId, profile);

    // Simulate a game having been set up
    admin.game.setCards(
      [{ id: 'card-1', number: 1 }],
      [],
      'playlist-xyz'
    );
    const originalGameId = admin.game.gameId;

    // Re-login with updated profile
    const updatedProfile = makeProfile({ name: 'Updated Name' });
    const refreshed = store.getOrCreate(profile.googleId, updatedProfile);

    expect(refreshed.game.gameId).toBe(originalGameId);
    expect(refreshed.game.cards).toHaveLength(1);
    expect(refreshed.name).toBe('Updated Name');
  });
});
