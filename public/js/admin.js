/* admin.js – Admin page logic */
'use strict';

const socket = io();

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const gameStatusEl  = document.getElementById('game-status');
const spotifyBadge  = document.getElementById('spotify-badge');
const spotifyBtn    = document.getElementById('spotify-btn');
const spotifyMsg    = document.getElementById('spotify-status-msg');
const playlistInput = document.getElementById('playlist-url');
const cardCountInput= document.getElementById('card-count');
const generateBtn   = document.getElementById('generate-btn');
const generateMsg   = document.getElementById('generate-msg');
const cardListSection = document.getElementById('card-list-section');
const cardListEl    = document.getElementById('card-list');
const startBtn      = document.getElementById('start-btn');
const endBtn        = document.getElementById('end-btn');
const resetBtn      = document.getElementById('reset-btn');
const gameMsg       = document.getElementById('game-msg');
const nowPlaying    = document.getElementById('now-playing');
const npArt         = document.getElementById('np-art');
const npTitle       = document.getElementById('np-title');
const npArtist      = document.getElementById('np-artist');
const playedList    = document.getElementById('played-list');
const noSongsMsg    = document.getElementById('no-songs-msg');
const winnersTable  = document.getElementById('winners-table');
const winnersBody   = document.getElementById('winners-body');
const noWinnersMsg  = document.getElementById('no-winners-msg');
const globalAlert   = document.getElementById('global-alert');

// ─── Auth feedback from URL params ────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
if (params.get('auth_success')) {
  spotifyMsg.innerHTML = `<div class="alert alert-success">✓ Spotify connected successfully!</div>`;
  history.replaceState({}, '', '/admin');
}
if (params.get('auth_error')) {
  spotifyMsg.innerHTML = `<div class="alert alert-error">Spotify error: ${params.get('auth_error')}</div>`;
  history.replaceState({}, '', '/admin');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setAlert(el, msg, type) {
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function updateGameStatus(status) {
  const labels = { idle: 'Idle', active: '● Active', ended: 'Ended' };
  const classes = { idle: 'status-idle', active: 'status-active', ended: 'status-ended' };
  gameStatusEl.textContent = labels[status] || status;
  gameStatusEl.className   = `status-pill ${classes[status] || 'status-idle'}`;

  startBtn.disabled = status !== 'idle' && status !== 'ended';
  endBtn.disabled   = status !== 'active';
}

function addWinnerRow(w, rank) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><span class="rank-badge ${rank === 1 ? 'first' : ''}">${rank}</span></td>
    <td>${escHtml(w.playerName)}</td>
    <td>Card #${w.cardNumber}</td>
    <td>${new Date(w.claimedAt).toLocaleTimeString()}</td>
  `;
  // Keep sorted
  const rows = winnersBody.querySelectorAll('tr');
  if (rows.length === 0 || rank > rows.length) {
    winnersBody.appendChild(tr);
  } else {
    winnersBody.insertBefore(tr, rows[rank - 1]);
  }
  winnersTable.style.display = 'table';
  noWinnersMsg.style.display = 'none';
}

function addPlayedSong(song) {
  noSongsMsg.style.display = 'none';
  const li = document.createElement('li');
  li.textContent = `${song.name} – ${song.artists}`;
  playedList.appendChild(li);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Generate cards ───────────────────────────────────────────────────────────
generateBtn.addEventListener('click', async () => {
  const playlistUrl = playlistInput.value.trim();
  const count       = parseInt(cardCountInput.value, 10);

  if (!playlistUrl) { setAlert(generateMsg, 'Please enter a playlist URL.', 'error'); return; }
  if (!count || count < 1) { setAlert(generateMsg, 'Enter a valid card count (≥ 1).', 'error'); return; }

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';
  setAlert(generateMsg, '', '');

  try {
    const res  = await fetch('/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ playlistUrl, count }),
    });
    const data = await res.json();

    if (!res.ok) { setAlert(generateMsg, data.error, 'error'); return; }

    setAlert(generateMsg, `✓ ${data.message} (${data.songCount} songs in playlist)`, 'success');
    renderCardList(data.cards);
  } catch (err) {
    setAlert(generateMsg, 'Network error: ' + err.message, 'error');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate cards';
  }
});

function renderCardList(cards) {
  cardListEl.innerHTML = cards.map(c =>
    `<a href="${c.url}" target="_blank">Card #${c.number}</a>`
  ).join('');
  cardListSection.style.display = 'block';
}

// ─── Game controls ────────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  const res  = await fetch('/api/game/start', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { setAlert(gameMsg, data.error, 'error'); return; }
  setAlert(gameMsg, '▶ Game started! Songs playing on Spotify will now appear here.', 'success');
});

endBtn.addEventListener('click', async () => {
  if (!confirm('End the game?')) return;
  const res  = await fetch('/api/game/end', { method: 'POST' });
  const data = await res.json();
  setAlert(gameMsg, data.message, 'info');
});

resetBtn.addEventListener('click', async () => {
  if (!confirm('Reset everything? This will clear all cards and game state.')) return;
  await fetch('/api/game/reset', { method: 'POST' });
  cardListEl.innerHTML    = '';
  cardListSection.style.display = 'none';
  playedList.innerHTML    = '';
  noSongsMsg.style.display = 'block';
  winnersBody.innerHTML   = '';
  winnersTable.style.display = 'none';
  noWinnersMsg.style.display = 'block';
  nowPlaying.style.display = 'none';
  setAlert(gameMsg, 'Game reset.', 'info');
});

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('game:state', (state) => {
  updateGameStatus(state.status);

  const connected = state.spotifyConnected;
  spotifyBadge.innerHTML = connected
    ? '<span style="color:var(--green);">✓ Spotify connected</span>'
    : '<span style="color:var(--text-m);">Spotify not connected</span>';
  if (connected) spotifyBtn.textContent = '✓ Reconnect Spotify';

  // Restore played songs
  if (state.playedSongs && state.playedSongs.length > 0) {
    noSongsMsg.style.display = 'none';
    state.playedSongs.forEach(addPlayedSong);
  }

  // Restore winners
  if (state.winners && state.winners.length > 0) {
    state.winners.forEach((w, i) => addWinnerRow(w, i + 1));
  }

  // Restore cards list
  if (state.cardCount > 0) {
    fetch('/api/cards')
      .then(r => r.json())
      .then(renderCardList);
  }
});

socket.on('game:started', (state) => {
  updateGameStatus(state.status);
  setAlert(gameMsg, '▶ Game is now active!', 'success');
});

socket.on('game:ended', (state) => {
  updateGameStatus(state.status);
  setAlert(gameMsg, 'Game has ended.', 'info');
});

socket.on('game:reset', () => {
  updateGameStatus('idle');
});

socket.on('song:playing', (song) => {
  npArt.src          = song.albumArt || '';
  npTitle.textContent = song.name;
  npArtist.textContent = song.artists;
  nowPlaying.style.display = 'flex';
  addPlayedSong(song);
});

socket.on('song:paused', () => {
  nowPlaying.style.display = 'none';
});

socket.on('bingo:claimed', (w) => {
  const rank = w.rank;
  addWinnerRow(w, rank);
  if (rank === 1) {
    setAlert(globalAlert,
      `🏆 <strong>${escHtml(w.playerName)}</strong> got BINGO! (Card #${w.cardNumber})`,
      'success');
  }
});
