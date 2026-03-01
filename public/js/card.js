/* card.js – Player bingo card logic */
'use strict';

const STORAGE_KEY_PREFIX = 'musicbingo_marked_';

const socket = io();

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const nameSection  = document.getElementById('name-section');
const nameInput    = document.getElementById('player-name');
const nameBtn      = document.getElementById('name-btn');
const cardSection  = document.getElementById('card-section');
const cardNumber   = document.getElementById('card-number');
const gameStatusEl = document.getElementById('game-status');
const bingoGrid    = document.getElementById('bingo-grid');
const bingoBtn     = document.getElementById('bingo-btn');
const bingoMsg     = document.getElementById('bingo-msg');
const nowPlaying   = document.getElementById('now-playing');
const npArt        = document.getElementById('np-art');
const npTitle      = document.getElementById('np-title');
const npArtist     = document.getElementById('np-artist');
const playedList   = document.getElementById('played-list');
const noSongsLi    = document.getElementById('no-songs-li');
const markedCount  = document.getElementById('marked-count');
const globalAlert  = document.getElementById('global-alert');

// ─── State ────────────────────────────────────────────────────────────────────
const cardId = window.location.pathname.split('/').pop();
let card        = null;
let playerName  = '';
let gameStatus  = 'idle';
let playedSongIds = new Set();
let markedCells   = new Set(); // "row,col" strings

// ─── Name gate ────────────────────────────────────────────────────────────────
function loadName() {
  return sessionStorage.getItem('musicbingo_player') || '';
}
function saveName(name) {
  sessionStorage.setItem('musicbingo_player', name);
}

nameBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  playerName = name;
  saveName(name);
  nameSection.style.display = 'none';
  loadCard();
});

nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameBtn.click(); });

// Auto-populate name from session
const saved = loadName();
if (saved) {
  playerName = saved;
  nameSection.style.display = 'none';
  loadCard();
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
function storageKey() { return STORAGE_KEY_PREFIX + cardId; }

function loadMarked() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) return new Set(JSON.parse(raw));
  } catch (_) {}
  return new Set();
}

function saveMarked() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...markedCells]));
  } catch (_) {}
}

// ─── Card loading & rendering ─────────────────────────────────────────────────
async function loadCard() {
  cardSection.style.display = 'block';
  try {
    const res = await fetch(`/api/card/${cardId}`);
    if (!res.ok) {
      setAlert('Card not found. Check the link and try again.', 'error');
      return;
    }
    card = await res.json();
    cardNumber.textContent = card.number;
    document.title = `Card #${card.number} – Music Bingo`;
    markedCells = loadMarked();
    renderGrid();
    updateMarkedCount();
  } catch (err) {
    setAlert('Failed to load card: ' + err.message, 'error');
  }
}

function renderGrid() {
  bingoGrid.innerHTML = '';
  card.grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      const div = document.createElement('div');
      div.className = 'bingo-cell';
      div.dataset.row = r;
      div.dataset.col = c;

      if (cell.isFree) {
        div.classList.add('free');
        div.textContent = 'FREE';
      } else {
        div.innerHTML = `
          <span class="cell-title">${escHtml(cell.song.name)}</span>
          <span class="cell-artist">${escHtml(cell.song.artists)}</span>
        `;
        if (playedSongIds.has(cell.song.id)) div.classList.add('played');
        if (markedCells.has(`${r},${c}`))   div.classList.add('marked');

        div.addEventListener('click', () => toggleCell(div, r, c, cell));
      }

      bingoGrid.appendChild(div);
    });
  });
}

function toggleCell(div, r, c, cell) {
  if (gameStatus !== 'active') return;
  if (!playedSongIds.has(cell.song.id)) return; // can only mark played songs

  const key = `${r},${c}`;
  if (markedCells.has(key)) {
    markedCells.delete(key);
    div.classList.remove('marked');
  } else {
    markedCells.add(key);
    div.classList.add('marked');
  }
  saveMarked();
  updateMarkedCount();
}

function updateMarkedCount() {
  const total = markedCells.size + 1; // +1 for FREE
  markedCount.textContent = `${total} / 25 marked`;
}

function highlightPlayed(songId) {
  if (!card) return;
  card.grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (!cell.isFree && cell.song && cell.song.id === songId) {
        const idx = r * 5 + c;
        const div = bingoGrid.children[idx];
        if (div) div.classList.add('played');
      }
    });
  });
}

// ─── Game status ──────────────────────────────────────────────────────────────
function updateGameStatus(status) {
  gameStatus = status;
  const labels  = { idle: 'Waiting for game…', active: '● Game active', ended: 'Game ended' };
  const classes = { idle: 'status-idle', active: 'status-active', ended: 'status-ended' };
  gameStatusEl.textContent = labels[status] || status;
  gameStatusEl.className   = `status-pill ${classes[status] || 'status-idle'}`;
  bingoBtn.disabled = status !== 'active';
}

// ─── Played songs ─────────────────────────────────────────────────────────────
function addPlayedSong(song) {
  playedSongIds.add(song.id);
  noSongsLi.style.display = 'none';
  const li = document.createElement('li');
  li.textContent = `${song.name} – ${song.artists}`;
  playedList.appendChild(li);
  highlightPlayed(song.id);
}

// ─── BINGO claim ──────────────────────────────────────────────────────────────
bingoBtn.addEventListener('click', async () => {
  if (!card || gameStatus !== 'active') return;

  bingoBtn.disabled = true;
  bingoBtn.textContent = 'Checking…';
  setBingoMsg('', '');

  const cells = [...markedCells].map((key) => {
    const [row, col] = key.split(',').map(Number);
    return { row, col };
  });

  try {
    const res  = await fetch('/api/bingo', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cardId, playerName, markedCells: cells }),
    });
    const data = await res.json();

    if (!res.ok) {
      setBingoMsg(data.error, 'error');
      bingoBtn.disabled = false;
      bingoBtn.textContent = 'BINGO!';
    } else {
      setBingoMsg(
        `🏆 BINGO validated! You are #${data.rank}! Pattern: ${friendlyPattern(data.pattern)}`,
        'success'
      );
      bingoBtn.textContent = '🏆 BINGO!';
    }
  } catch (err) {
    setBingoMsg('Network error: ' + err.message, 'error');
    bingoBtn.disabled = false;
    bingoBtn.textContent = 'BINGO!';
  }
});

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('game:state', (state) => {
  updateGameStatus(state.status);

  if (state.playedSongs && state.playedSongs.length > 0) {
    state.playedSongs.forEach((song) => {
      if (!playedSongIds.has(song.id)) addPlayedSong(song);
    });
    // Re-render grid to reflect played songs
    if (card) renderGrid();
  }

  if (state.currentSong) {
    showNowPlaying(state.currentSong);
  }
});

socket.on('game:started', (state) => {
  updateGameStatus('active');
  playedSongIds = new Set();
  markedCells   = new Set();
  saveMarked();
  if (card) renderGrid();
  setAlert('', '');
});

socket.on('game:ended', () => { updateGameStatus('ended'); });
socket.on('game:reset',  () => { updateGameStatus('idle'); });

socket.on('song:playing', (song) => {
  showNowPlaying(song);
  addPlayedSong(song);
});

socket.on('song:paused', () => {
  nowPlaying.style.display = 'none';
});

socket.on('bingo:claimed', (w) => {
  if (w.cardId === cardId) return; // already handled locally
  setAlert(
    `🏆 <strong>${escHtml(w.playerName)}</strong> got BINGO on Card #${w.cardNumber}!`,
    w.rank === 1 ? 'success' : 'info'
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showNowPlaying(song) {
  npArt.src           = song.albumArt || '';
  npTitle.textContent  = song.name;
  npArtist.textContent = song.artists;
  nowPlaying.style.display = 'flex';
}

function setAlert(msg, type) {
  if (!msg) { globalAlert.innerHTML = ''; return; }
  globalAlert.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function setBingoMsg(msg, type) {
  if (!msg) { bingoMsg.innerHTML = ''; return; }
  bingoMsg.innerHTML = `<div class="alert alert-${type}" style="text-align:center;">${msg}</div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function friendlyPattern(pattern) {
  if (!pattern) return pattern;
  if (pattern.startsWith('row-'))      return `Row ${parseInt(pattern.split('-')[1], 10) + 1}`;
  if (pattern.startsWith('col-'))      return `Column ${parseInt(pattern.split('-')[1], 10) + 1}`;
  if (pattern === 'diagonal-tl-br')   return 'Diagonal (top-left to bottom-right)';
  if (pattern === 'diagonal-tr-bl')   return 'Diagonal (top-right to bottom-left)';
  return pattern;
}
