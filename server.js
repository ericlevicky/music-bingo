/**
 * server.js – Music Bingo Express + Socket.io server.
 *
 * Routes:
 *   GET  /                        Player landing page
 *   GET  /admin                   Admin page
 *   GET  /card/:id                Individual bingo card page
 *   GET  /auth/login              Start Spotify OAuth
 *   GET  /auth/callback           Spotify OAuth callback
 *
 * API:
 *   GET  /api/status              Current game status snapshot
 *   GET  /api/playlist?url=       Fetch playlist info & song count
 *   POST /api/generate            Generate bingo cards
 *   GET  /api/cards               List all generated cards (id + number + link)
 *   GET  /api/card/:id            Get full card data
 *   POST /api/game/start          Start the game
 *   POST /api/game/end            End the game
 *   POST /api/game/reset          Reset everything
 *   POST /api/bingo               Submit a bingo claim
 *   GET  /api/winners             Get the winners list
 */

'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');

const rateLimit = require('express-rate-limit');

const spotify = require('./src/spotify');
const { generateCards, validateBingo } = require('./src/bingo');
const game = require('./src/game');

/** Maximum number of cards that can be generated in one request (memory safety). */
const MAX_CARDS = 500;

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

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── HTML page routes ─────────────────────────────────────────────────────────

app.get('/', generalLimiter, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.get('/admin', generalLimiter, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);

app.get('/card/:id', generalLimiter, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'card.html'))
);

// ─── Spotify OAuth ────────────────────────────────────────────────────────────

app.get('/auth/login',    strictLimiter, spotify.getAuthUrl);
app.get('/auth/callback', strictLimiter, spotify.handleCallback);

// ─── API ──────────────────────────────────────────────────────────────────────

app.get('/api/status', generalLimiter, (req, res) => {
  res.json({
    ...game.toJSON(),
    spotifyConnected: spotify.isAuthenticated(),
  });
});

app.get('/api/playlist', strictLimiter, async (req, res) => {
  if (!spotify.isAuthenticated()) {
    return res.status(401).json({ error: 'Spotify not connected. Please authorise first.' });
  }

  const { url } = req.query;
  const playlistId = spotify.extractPlaylistId(url);

  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid Spotify playlist URL or ID.' });
  }

  try {
    const songs = await spotify.getPlaylistSongs(playlistId);
    res.json({ playlistId, songCount: songs.length, songs });
  } catch (err) {
    console.error('Playlist fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate', strictLimiter, async (req, res) => {
  if (!spotify.isAuthenticated()) {
    return res.status(401).json({ error: 'Spotify not connected. Please authorise first.' });
  }

  const { playlistUrl, count } = req.body;
  const cardCount = parseInt(count, 10);

  if (!playlistUrl) {
    return res.status(400).json({ error: 'playlistUrl is required.' });
  }
  if (!Number.isFinite(cardCount) || cardCount < 1 || cardCount > MAX_CARDS) {
    return res.status(400).json({ error: `count must be between 1 and ${MAX_CARDS}.` });
  }

  const playlistId = spotify.extractPlaylistId(playlistUrl);
  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid Spotify playlist URL or ID.' });
  }

  try {
    const songs = await spotify.getPlaylistSongs(playlistId);
    if (songs.length < 24) {
      return res.status(400).json({
        error: `Playlist only has ${songs.length} tracks. At least 24 are required.`,
      });
    }

    const cards = generateCards(songs, cardCount);
    game.setCards(cards, songs, playlistId);

    res.json({
      message: `Generated ${cards.length} bingo cards.`,
      cardCount: cards.length,
      songCount: songs.length,
      cards: cards.map(({ id, number }) => ({ id, number, url: `/card/${id}` })),
    });
  } catch (err) {
    console.error('Card generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cards', generalLimiter, (req, res) => {
  res.json(
    game.cards.map(({ id, number }) => ({ id, number, url: `/card/${id}` }))
  );
});

app.get('/api/card/:id', generalLimiter, (req, res) => {
  const card = game.getCardById(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found.' });
  res.json(card);
});

app.post('/api/game/start', strictLimiter, (req, res) => {
  try {
    game.start();
    startPolling();
    io.emit('game:started', game.toJSON());
    res.json({ message: 'Game started.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/game/end', strictLimiter, (req, res) => {
  game.end();
  stopPolling();
  io.emit('game:ended', game.toJSON());
  res.json({ message: 'Game ended.' });
});

app.post('/api/game/reset', strictLimiter, (req, res) => {
  game.reset();
  stopPolling();
  io.emit('game:reset');
  res.json({ message: 'Game reset.' });
});

app.post('/api/bingo', strictLimiter, (req, res) => {
  if (game.status !== 'active') {
    return res.status(400).json({ error: 'No active game.' });
  }

  const { cardId, playerName, markedCells } = req.body;

  if (!cardId || !playerName || !Array.isArray(markedCells)) {
    return res.status(400).json({ error: 'cardId, playerName, and markedCells are required.' });
  }

  const card = game.getCardById(cardId);
  if (!card) return res.status(404).json({ error: 'Card not found.' });

  // Check if this card already won
  if (game.winners.some((w) => w.cardId === cardId)) {
    return res.status(400).json({ error: 'This card has already claimed a valid bingo.' });
  }

  const { isValid, pattern } = validateBingo(card.grid, game.playedSongIds, markedCells);

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

  const rank = game.addWinner(claim);
  const result = { ...claim, rank };

  io.emit('bingo:claimed', result);
  res.json(result);
});

app.get('/api/winners', generalLimiter, (req, res) => {
  res.json(game.winners);
});

// ─── Spotify polling ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;
let pollTimer = null;
let _lastSongId = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const song = await spotify.getCurrentlyPlaying();

      if (song && song.id !== _lastSongId) {
        _lastSongId = song.id;
        game.recordSong(song);
        io.emit('song:playing', song);
      }

      if (!song && _lastSongId !== null) {
        _lastSongId = null;
        io.emit('song:paused');
      }
    } catch (err) {
      console.error('Polling error:', err.message);
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  _lastSongId = null;
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  // Send current game state to newly-connected client
  socket.emit('game:state', {
    ...game.toJSON(),
    spotifyConnected: spotify.isAuthenticated(),
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Music Bingo server running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);
});

module.exports = { app, server }; // exported for testing
