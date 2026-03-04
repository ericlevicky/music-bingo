/* card.js – Player bingo card logic */
'use strict';

const STORAGE_KEY_PREFIX  = 'musicbingo_marked_';
// Character-length thresholds for scaling down long song titles in bingo cells.
// These coordinate with the .cell-title-sm / .cell-title-xs CSS classes.
const TITLE_SM_THRESHOLD  = 14;  // titles longer than this get a smaller font
const TITLE_XS_THRESHOLD  = 22;  // titles longer than this get an even smaller font

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
const songsHistory = document.getElementById('songs-history');
const winOverlay      = document.getElementById('win-overlay');
const winOverlayTitle = document.getElementById('win-overlay-title');
const winOverlaySub   = document.getElementById('win-overlay-sub');
const winOverlayClose = document.getElementById('win-overlay-close');

// ─── State ────────────────────────────────────────────────────────────────────
const cardId = window.location.pathname.split('/').pop();
let card        = null;
let playerName  = '';
let gameStatus  = 'idle';
let playedSongIds = new Set();
let markedCells   = new Set(); // "row,col" strings
let currentSong   = null;     // currently playing track
let playerOptions = {
  showSongHistory:  true,
  showNowPlaying:   true,
  showHint:         true,
  strictValidation: true,
  freeSpace:        true,
  bingoMode:        'any-line',
};

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
    cardNumber.textContent = playerName;
    document.title = `${playerName} – Music Bingo`;
    // Apply the admin's current settings immediately so the first render is correct.
    if (card.playerOptions) {
      playerOptions = { ...playerOptions, ...card.playerOptions };
    }
    markedCells = loadMarked();
    renderGrid();
    updateMarkedCount();

    // Join the game room so we receive real-time updates for this game
    if (card.gameId) {
      socket.emit('player:join', { gameId: card.gameId });
    }
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
        if (playerOptions.freeSpace !== false) {
          div.classList.add('free');
          div.textContent = 'FREE';
        } else {
          // Free space is disabled – render its song like a regular markable cell.
          div.title = `${cell.song.name} – ${cell.song.artists}`;
          applyLongTitleClass(div, cell.song.name);
          div.innerHTML = `
            <span class="cell-title">${escHtml(cell.song.name)}</span>
            <span class="cell-artist">${escHtml(cell.song.artists)}</span>
          `;
          if (markedCells.has(`${r},${c}`)) div.classList.add('marked');
          div.addEventListener('click', () => toggleCell(div, r, c, cell));
        }
      } else {
        div.title = `${cell.song.name} – ${cell.song.artists}`;
        applyLongTitleClass(div, cell.song.name);
        div.innerHTML = `
          <span class="cell-title">${escHtml(cell.song.name)}</span>
          <span class="cell-artist">${escHtml(cell.song.artists)}</span>
        `;
        if (markedCells.has(`${r},${c}`))   div.classList.add('marked');

        div.addEventListener('click', () => toggleCell(div, r, c, cell));
      }

      bingoGrid.appendChild(div);
    });
  });
}

function toggleCell(div, r, c, cell) {
  if (gameStatus !== 'active') return;
  const isCurrentlyPlaying = currentSong?.id === cell.song?.id;
  if (!isCurrentlyPlaying && playerOptions.strictValidation && !playedSongIds.has(cell.song.id)) return;

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
  const freeCount = playerOptions.freeSpace !== false ? 1 : 0;
  const total = markedCells.size + freeCount;
  markedCount.textContent = `${total} / 25 marked`;
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
      if (data.rank === 1) showWinCelebration(playerName, data.cardNumber);
    }
  } catch (err) {
    setBingoMsg('Network error: ' + err.message, 'error');
    bingoBtn.disabled = false;
    bingoBtn.textContent = 'BINGO!';
  }
});

// ─── Socket events ────────────────────────────────────────────────────────────

// When admin emits game:state to us after we join the room
socket.on('game:state', (state) => {
  updateGameStatus(state.status);

  if (state.playerOptions) {
    playerOptions = { ...playerOptions, ...state.playerOptions };
    applyPlayerOptions();
  }

  if (state.playedSongs && state.playedSongs.length > 0) {
    state.playedSongs.forEach((song) => {
      if (!playedSongIds.has(song.id)) addPlayedSong(song);
    });
    if (card) renderGrid();
  }

  if (state.currentSong) {
    showNowPlaying(state.currentSong);
    updateHints(state.currentSong);
  }
});

socket.on('game:started', (state = {}) => {
  if (state.playerOptions) {
    playerOptions = { ...playerOptions, ...state.playerOptions };
  }
  updateGameStatus('active');
  playedSongIds = new Set();
  markedCells   = new Set();
  saveMarked();
  if (card) renderGrid();
  setAlert('', '');
});

socket.on('game:ended', () => {
  updateGameStatus('ended');
  currentSong = null;
  nowPlaying.style.display = 'none';
  updateHints(null);
});
socket.on('game:reset', () => {
  updateGameStatus('idle');
  markedCells = new Set();
  saveMarked();
  if (card) loadCard();
});

socket.on('song:playing', ({ song, previousSong }) => {
  if (previousSong && !playedSongIds.has(previousSong.id)) addPlayedSong(previousSong);
  showNowPlaying(song);
  updateHints(song);
});

socket.on('song:paused', (data = {}) => {
  const finishedSong = data && data.finishedSong;
  if (finishedSong && !playedSongIds.has(finishedSong.id)) addPlayedSong(finishedSong);
  currentSong = null;
  nowPlaying.style.display = 'none';
  updateHints(null);
});

socket.on('bingo:claimed', (w) => {
  // Rank-1 winner always gets the celebration overlay (even on this player's own card,
  // since the local BINGO handler already fires the overlay only for rank 1 — here
  // the socket event from other players also triggers it for everyone else in the room).
  if (w.rank === 1) {
    showWinCelebration(w.playerName, w.cardNumber);
  } else if (w.cardId !== cardId) {
    // For later-rank wins, show a quieter alert only to other players' cards
    // (this card's own claim is already surfaced via the BINGO button response).
    setAlert(
      `🏆 <strong>${escHtml(w.playerName)}</strong> got BINGO on Card #${w.cardNumber}!`,
      'info'
    );
  }
});

socket.on('game:options', (opts) => {
  playerOptions = { ...playerOptions, ...opts };
  applyPlayerOptions();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showNowPlaying(song) {
  currentSong = song;
  npArt.src           = song.albumArt || '';
  npTitle.textContent  = song.name;
  npArtist.textContent = song.artists;
  if (playerOptions.showNowPlaying) nowPlaying.style.display = 'flex';
}

/** Apply current playerOptions to all visible elements. */
function applyPlayerOptions() {
  // Song history
  if (songsHistory) {
    if (!playerOptions.showSongHistory) {
      songsHistory.style.display = 'none';
    } else {
      songsHistory.style.display = '';
    }
  }
  // Now playing banner
  if (!playerOptions.showNowPlaying) {
    nowPlaying.style.display = 'none';
  } else if (currentSong) {
    nowPlaying.style.display = 'flex';
  }
  // Re-render grid to reflect freeSpace change (and restore marked state)
  if (card) renderGrid();
  // Cell hints
  updateHints(currentSong);
  // Marked count (freeSpace affects the +1 for FREE)
  updateMarkedCount();
}

/** Highlight cells whose song matches the currently playing track. */
function updateHints(song) {
  document.querySelectorAll('.bingo-cell.hint').forEach((el) => el.classList.remove('hint'));
  if (!playerOptions.showHint || !song || !card) return;
  document.querySelectorAll('.bingo-cell').forEach((el) => {
    const r = parseInt(el.dataset.row, 10);
    const c = parseInt(el.dataset.col, 10);
    if (isNaN(r) || isNaN(c)) return;
    const cell = card.grid[r][c];
    // Add a hint for any cell whose song matches the playing track.
    // The centre cell has isFree:true in the grid, but when freeSpace is
    // disabled it is rendered as a regular markable cell and should still
    // receive a hint, so we also check !playerOptions.freeSpace.
    if (cell.song && cell.song.id === song.id && (!cell.isFree || !playerOptions.freeSpace)) {
      el.classList.add('hint');
    }
  });
}

function setAlert(msg, type) {
  if (!msg) { globalAlert.innerHTML = ''; return; }
  globalAlert.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function setBingoMsg(msg, type) {
  if (!msg) { bingoMsg.innerHTML = ''; return; }
  bingoMsg.innerHTML = `<div class="alert alert-${type}" style="text-align:center;">${msg}</div>`;
}

/** Apply a CSS modifier class to scale down font for long song titles. */
function applyLongTitleClass(el, title) {
  const len = (title || '').length;
  if (len > TITLE_XS_THRESHOLD) el.classList.add('cell-title-xs');
  else if (len > TITLE_SM_THRESHOLD) el.classList.add('cell-title-sm');
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
  if (pattern.startsWith('row-')) {
    const n = parseInt(pattern.slice(4), 10) + 1;
    return `Row ${n}`;
  }
  if (pattern.startsWith('col-')) {
    const n = parseInt(pattern.slice(4), 10) + 1;
    return `Column ${n}`;
  }
  if (pattern === 'diagonal-tl-br') return 'Diagonal (top-left to bottom-right)';
  if (pattern === 'diagonal-tr-bl') return 'Diagonal (top-right to bottom-left)';
  if (pattern === 'postage-stamp-tl') return 'Postage Stamp (top-left corner)';
  if (pattern === 'postage-stamp-tr') return 'Postage Stamp (top-right corner)';
  if (pattern === 'postage-stamp-bl') return 'Postage Stamp (bottom-left corner)';
  if (pattern === 'postage-stamp-br') return 'Postage Stamp (bottom-right corner)';
  if (pattern === 'full-board') return 'Full Board (Blackout!)';
  if (pattern === 'x-pattern') return 'X Pattern (both diagonals)';
  return pattern;
}

/** Show a full-board celebration overlay for the first-place winner. */
function showWinCelebration(winnerName, cardNumber) {
  winOverlayTitle.textContent = `🎉 ${winnerName} Wins!`;
  winOverlaySub.textContent   = `Card #${cardNumber} got BINGO first!`;
  winOverlay.classList.add('visible');
  // Stagger a flash animation across every grid cell
  document.querySelectorAll('.bingo-cell').forEach((el, i) => {
    el.classList.remove('win-flash');
    setTimeout(() => el.classList.add('win-flash'), i * 40);
  });
}

winOverlayClose.addEventListener('click', () => {
  winOverlay.classList.remove('visible');
});
winOverlay.addEventListener('click', (e) => {
  if (e.target === winOverlay) winOverlay.classList.remove('visible');
});
