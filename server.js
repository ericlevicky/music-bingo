/**
 * server.js – Music Bingo Express + Socket.io server.
 *
 * Auth:
 *   GET  /login                      Admin login page
 *   GET  /auth/google                Start Google OAuth
 *   GET  /auth/google/callback       Google OAuth callback
 *   GET  /auth/logout                Log out
 *   GET  /auth/spotify               Start Spotify OAuth (requires admin login)
 *   GET  /auth/spotify/callback      Spotify OAuth callback (requires admin login)
 *
 * Pages (admin-protected):
 *   GET  /admin                      Admin dashboard
 *
 * Pages (public):
 *   GET  /                           Player landing page
 *   GET  /card/:id                   Individual bingo card page
 *
 * API (admin-protected):
 *   GET  /api/admin/profile          Current admin profile + game state
 *   GET  /api/admin/playlists        Admin's Spotify playlists
 *   POST /api/generate               Generate bingo cards (with contact assignment)
 *   GET  /api/cards                  List cards for current admin
 *   POST /api/game/start             Start the game
 *   POST /api/game/end               End the game
 *   POST /api/game/reset             Reset everything
 *   GET  /api/winners                Winners list
 *
 * API (public):
 *   GET  /api/card/:id               Get card data (for player page)
 *   POST /api/bingo                  Submit a bingo claim
 */

'use strict';

require('dotenv').config();

const path    = require('path');
const http    = require('http');
const crypto  = require('crypto');
const express = require('express');
const session = require('express-session');
const { Server: SocketServer } = require('socket.io');
const rateLimit = require('express-rate-limit');

const { name: APP_NAME, version: APP_VERSION } = require('./package.json');

const MemoryStore = require('memorystore');
const MemStoreSession = MemoryStore(session);

const passport  = require('./src/auth');
const store     = require('./src/store');
const { generateCards, validateBingo } = require('./src/bingo');
const { buildAuthUrl, exchangeCode, extractPlaylistId } = require('./src/spotify');

/** Maximum number of cards per generate request (memory safety). */
const MAX_CARDS = 500;

const app    = express();
const server = http.createServer(app);
const io     = new SocketServer(server);

// ─── Rate limiters ────────────────────────────────────────────────────────────

/** General page / API reads – 120 requests per minute per IP. */
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Auth / write routes – 20 requests per minute per IP to limit brute-force. */
const strictLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Middleware ───────────────────────────────────────────────────────────────

// Render (and most PaaS hosts) terminate TLS at a reverse proxy and forward
// plain HTTP to Node.js.  Without this, express-session sees HTTP and silently
// suppresses the Set-Cookie header for cookies marked `secure: true`, so the
// session is never stored in the browser and every request appears unauthenticated.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new MemStoreSession({
      checkPeriod: 86_400_000,   // prune expired entries every 24 h
      ttl: 7 * 24 * 60 * 60 * 1000,  // session TTL matches cookie maxAge (7 days)
    }),
    secret: process.env.SESSION_SECRET || 'music-bingo-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',                                   // CSRF protection for nav-based requests
      secure: process.env.NODE_ENV === 'production',     // HTTPS-only in production
      maxAge: 7 * 24 * 60 * 60 * 1000,                  // 7 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Middleware: require an authenticated admin session. */
function ensureAdmin(req, res, next) {
  if (req.isAuthenticated()) return next();
  // API routes always respond with JSON 401 regardless of Accept header
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  res.redirect('/login');
}

/** Middleware: require an authenticated admin who has connected Spotify. */
function ensureSpotify(req, res, next) {
  if (!req.user.hasSpotify()) {
    return res.status(400).json({ error: 'Spotify not connected. Please authorise first.' });
  }
  next();
}

// ─── HTML page routes ─────────────────────────────────────────────────────────

app.get('/', generalLimiter, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.get('/login', generalLimiter, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
);

app.get('/admin', generalLimiter, ensureAdmin, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);

app.get('/card/:id', generalLimiter, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'card.html'))
);

// ─── Health check (used by Render to verify the service is alive) ─────────────

app.get('/health', (req, res) => res.json({ status: 'ok', name: APP_NAME, version: APP_VERSION }));

// ─── Google OAuth ─────────────────────────────────────────────────────────────

app.get(
  '/auth/google',
  strictLimiter,
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get(
  '/auth/google/callback',
  strictLimiter,
  passport.authenticate('google', { failureRedirect: '/login?error=google_auth_failed' }),
  (req, res) => res.redirect('/admin')
);

app.get('/auth/logout', strictLimiter, (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

// ─── Spotify OAuth (per-admin) ────────────────────────────────────────────────

app.get('/auth/spotify', strictLimiter, ensureAdmin, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  // Build the redirect URI from the live request so it always matches exactly
  // what the user must register in the Spotify Developer Dashboard.
  // With `trust proxy: 1`, req.protocol correctly returns 'https' on Render.
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/spotify/callback`;
  req.session.spotifyState = state;
  req.session.spotifyRedirectUri = redirectUri;
  res.redirect(buildAuthUrl(state, redirectUri));
});

app.get('/auth/spotify/callback', strictLimiter, ensureAdmin, async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect(`/admin?spotify_error=${encodeURIComponent(error)}`);
  }
  if (state !== req.session.spotifyState) {
    return res.redirect('/admin?spotify_error=state_mismatch');
  }

  // Retrieve the redirect URI saved when the flow was initiated, then clear
  // both values from the session so the code cannot be replayed.
  // Fall back to computing the URI from the request if the session value is
  // missing (e.g. direct navigation to the callback URL).
  const redirectUri =
    req.session.spotifyRedirectUri ||
    `${req.protocol}://${req.get('host')}/auth/spotify/callback`;
  delete req.session.spotifyState;
  delete req.session.spotifyRedirectUri;

  try {
    const tokens = await exchangeCode(code, redirectUri);
    req.user.setSpotifyTokens(tokens);
    res.redirect('/admin?spotify_success=1');
  } catch (err) {
    console.error('Spotify auth error:', err.message);
    res.redirect(`/admin?spotify_error=${encodeURIComponent(err.message)}`);
  }
});

// ─── Admin API ────────────────────────────────────────────────────────────────

app.get('/api/admin/profile', generalLimiter, ensureAdmin, (req, res) => {
  const { googleId, email, name, picture, game } = req.user;
  res.json({
    googleId,
    email,
    name,
    picture,
    spotifyConnected: req.user.hasSpotify(),
    game: game.toJSON(),
  });
});

app.get('/api/admin/playlists', strictLimiter, ensureAdmin, ensureSpotify, async (req, res) => {
  try {
    const playlists = await req.user.spotifyClient.getUserPlaylists();
    res.json(playlists);
  } catch (err) {
    console.error('Playlist list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate', strictLimiter, ensureAdmin, ensureSpotify, async (req, res) => {
  const { playlistId, contacts } = req.body;

  if (!playlistId) {
    return res.status(400).json({ error: 'playlistId is required.' });
  }

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts must be a non-empty array.' });
  }

  const totalCards = contacts.reduce((sum, c) => sum + (parseInt(c.count, 10) || 1), 0);
  if (totalCards > MAX_CARDS) {
    return res.status(400).json({ error: `Total cards (${totalCards}) exceeds maximum of ${MAX_CARDS}.` });
  }

  const pid = extractPlaylistId(playlistId);
  if (!pid) {
    return res.status(400).json({ error: 'Invalid Spotify playlist ID.' });
  }

  try {
    const songs = await req.user.spotifyClient.getPlaylistSongs(pid);
    if (songs.length < 24) {
      return res.status(400).json({
        error: `Playlist only has ${songs.length} tracks. At least 24 are required.`,
      });
    }

    // Deindex old cards before replacing them
    store.deindexCards(req.user.googleId);

    const normalised = contacts
      .map((c) => ({ value: String(c.value || '').trim(), count: parseInt(c.count, 10) || 1 }))
      .filter((c) => c.value);

    const cards = generateCards(songs, normalised);
    req.user.game.setCards(cards, songs, pid);
    store.indexCards(req.user.googleId, cards);

    res.json({
      message: `Generated ${cards.length} bingo cards.`,
      gameId:  req.user.game.gameId,
      cardCount: cards.length,
      songCount: songs.length,
      cards: cards.map(({ id, number, contact }) => ({ id, number, contact, url: `/card/${id}` })),
    });
  } catch (err) {
    console.error('Card generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cards', generalLimiter, ensureAdmin, (req, res) => {
  res.json(
    req.user.game.cards.map(({ id, number, contact }) => ({
      id, number, contact, url: `/card/${id}`,
    }))
  );
});

app.post('/api/game/start', strictLimiter, ensureAdmin, (req, res) => {
  try {
    req.user.game.start();
    startPolling(req.user);
    io.to(`game:${req.user.game.gameId}`).emit('game:started', req.user.game.toJSON());
    res.json({ message: 'Game started.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/game/end', strictLimiter, ensureAdmin, (req, res) => {
  req.user.game.end();
  stopPolling(req.user);
  io.to(`game:${req.user.game.gameId}`).emit('game:ended', req.user.game.toJSON());
  res.json({ message: 'Game ended.' });
});

app.post('/api/game/reset', strictLimiter, ensureAdmin, (req, res) => {
  const oldGameId = req.user.game.gameId;
  stopPolling(req.user);
  store.deindexCards(req.user.googleId);
  req.user.game.reset();
  if (oldGameId) io.to(`game:${oldGameId}`).emit('game:reset');
  res.json({ message: 'Game reset.' });
});

app.get('/api/winners', generalLimiter, ensureAdmin, (req, res) => {
  res.json(req.user.game.winners);
});

// ─── Public card API ──────────────────────────────────────────────────────────

app.get('/api/card/:id', generalLimiter, (req, res) => {
  const result = store.findCard(req.params.id);
  if (!result) return res.status(404).json({ error: 'Card not found.' });
  const { card, admin } = result;
  res.json({ ...card, gameId: admin.game.gameId });
});

app.post('/api/bingo', strictLimiter, async (req, res) => {
  const { cardId, playerName, markedCells } = req.body;

  if (!cardId || !playerName || !Array.isArray(markedCells)) {
    return res.status(400).json({ error: 'cardId, playerName, and markedCells are required.' });
  }

  const result = store.findCard(cardId);
  if (!result) return res.status(404).json({ error: 'Card not found.' });

  const { admin, card } = result;

  if (admin.game.status !== 'active') {
    return res.status(400).json({ error: 'No active game.' });
  }

  if (admin.game.winners.some((w) => w.cardId === cardId)) {
    return res.status(400).json({ error: 'This card has already claimed a valid bingo.' });
  }

  const { isValid, pattern } = validateBingo(card.grid, admin.game.playedSongIds, markedCells);

  if (!isValid) {
    return res.status(400).json({ error: 'Not a valid bingo. Keep playing!' });
  }

  const claim = {
    cardId,
    cardNumber: card.number,
    playerName,
    pattern,
    claimedAt: new Date().toISOString(),
  };

  const rank    = admin.game.addWinner(claim);
  const payload = { ...claim, rank };

  io.to(`game:${admin.game.gameId}`).emit('bingo:claimed', payload);
  res.json(payload);
});

// ─── Spotify polling (per admin) ──────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;

function startPolling(admin) {
  if (admin._pollTimer) return;
  admin._pollTimer = setInterval(async () => {
    try {
      const song   = await admin.spotifyClient.getCurrentlyPlaying();
      const gameId = admin.game.gameId;

      if (song && song.id !== admin._lastSongId) {
        admin._lastSongId = song.id;
        admin.game.recordSong(song);
        io.to(`game:${gameId}`).emit('song:playing', song);
      }

      if (!song && admin._lastSongId !== null) {
        admin._lastSongId = null;
        io.to(`game:${gameId}`).emit('song:paused');
      }
    } catch (err) {
      console.error('Polling error:', err.message);
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling(admin) {
  if (admin._pollTimer) {
    clearInterval(admin._pollTimer);
    admin._pollTimer = null;
  }
  admin._lastSongId = null;
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  /**
   * Admin client joins the room for their active game.
   * Payload: { googleId }
   */
  socket.on('admin:join', ({ googleId } = {}) => {
    const admin = store.getAdmin(googleId);
    if (!admin || !admin.game.gameId) return;
    socket.join(`game:${admin.game.gameId}`);
    socket.emit('game:state', {
      ...admin.game.toJSON(),
      spotifyConnected: admin.hasSpotify(),
    });
  });

  /**
   * Player client joins the room for a specific game.
   * Payload: { gameId }
   */
  socket.on('player:join', ({ gameId } = {}) => {
    if (!gameId) return;
    socket.join(`game:${gameId}`);
    const admin = store.findAdminByGameId(gameId);
    if (admin) {
      socket.emit('game:state', admin.game.toJSON());
    }
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Music Bingo server running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);
});

module.exports = { app, server };
