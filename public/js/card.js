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
const renameBtn    = document.getElementById('rename-btn');
const renameForm   = document.getElementById('rename-form');
const renameInput  = document.getElementById('rename-input');
const renameSaveBtn = document.getElementById('rename-save-btn');
const renameCancelBtn = document.getElementById('rename-cancel-btn');
const renameMsg    = document.getElementById('rename-msg');
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
const markedCount      = document.getElementById('marked-count');
const bingoModeLabel   = document.getElementById('bingo-mode-label');
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

// ─── Rename ───────────────────────────────────────────────────────────────────
renameBtn.addEventListener('click', () => {
  renameInput.value = playerName;
  renameForm.style.display = 'block';
  renameBtn.style.display = 'none';
  renameInput.focus();
  renameInput.select();
});

renameCancelBtn.addEventListener('click', () => {
  renameForm.style.display = 'none';
  renameBtn.style.display = '';
  if (renameMsg) renameMsg.innerHTML = '';
});

renameSaveBtn.addEventListener('click', doRename);
renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); });

async function doRename() {
  const newName = renameInput.value.trim();
  if (!newName) { renameInput.focus(); return; }
  if (newName === playerName) {
    renameForm.style.display = 'none';
    renameBtn.style.display = '';
    return;
  }

  renameSaveBtn.disabled = true;
  try {
    const res = await fetch(`/api/card/${cardId}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: newName }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (renameMsg) renameMsg.innerHTML = `<span style="color:var(--red);font-size:.8rem;">${escHtml(data.error)}</span>`;
      return;
    }
    playerName = newName;
    saveName(newName);
    cardNumber.textContent = newName;
    document.title = `${newName} – Music Bingo`;
    renameForm.style.display = 'none';
    renameBtn.style.display = '';
    if (renameMsg) renameMsg.innerHTML = '';
  } catch (err) {
    if (renameMsg) renameMsg.innerHTML = `<span style="color:var(--red);font-size:.8rem;">Network error</span>`;
  } finally {
    renameSaveBtn.disabled = false;
  }
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
    updateModeLabel();

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

  let res = null, data = null;
  try {
    res  = await fetch('/api/bingo', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cardId, playerName, markedCells: cells }),
    });
    data = await res.json();
  } catch (err) {
    setBingoMsg('Network error: ' + err.message, 'error');
    bingoBtn.disabled = false;
    bingoBtn.textContent = 'BINGO!';
    return;
  }

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
    showWinCelebration(playerName, data.cardNumber, data.rank);
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
  applyPlayerOptions();
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
  showWinCelebration(w.playerName, w.cardNumber, w.rank, w.celebrationEmoji);
});

socket.on('player:kicked', ({ cardId: kickedId }) => {
  if (kickedId !== cardId) return;
  // This player has been removed by the admin
  cardSection.style.display = 'none';
  setAlert('You have been removed from this game by the admin.', 'error');
  // Prevent further interaction
  socket.disconnect();
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
  // When free space is re-enabled, drop the center cell from markedCells so it
  // isn't double-counted (the FREE square is always worth +1 via updateMarkedCount).
  // Note: if the player had previously marked the center cell while freeSpace was
  // disabled, that mark is intentionally cleared here — the cell is now FREE and
  // automatically valid, so the explicit mark is no longer meaningful.
  if (card) {
    const freeRow = Math.floor(card.grid.length / 2);
    const freeCol = Math.floor((card.grid[0] || []).length / 2);
    if (playerOptions.freeSpace !== false) {
      // Re-enabled: remove any manual mark so the cell isn't double-counted.
      markedCells.delete(`${freeRow},${freeCol}`);
      saveMarked();
    }
    // When freeSpace becomes disabled the center cell renders as a regular
    // markable cell (starting unmarked). No change to markedCells is needed.
  }
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
  // Bingo mode label
  updateModeLabel();
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

function friendlyMode(mode) {
  const labels = {
    'any-line':      'Any Line',
    'postage-stamp': 'Postage Stamp',
    'full-board':    'Full Board',
    'x-pattern':     'X Pattern',
  };
  return labels[mode] || mode || 'Any Line';
}

function updateModeLabel() {
  if (!bingoModeLabel) return;
  bingoModeLabel.textContent = `Mode: ${friendlyMode(playerOptions.bingoMode)}`;
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

/** Rain a chosen emoji across the screen for a few seconds. */
function startEmojiRain(emoji) {
  const container = document.createElement('div');
  container.className = 'emoji-rain';
  document.body.appendChild(container);
  const count = 35;
  for (let _ = 0; _ < count; _++) {
    const span = document.createElement('span');
    span.className = 'emoji-rain-particle';
    span.textContent = emoji;
    span.style.left            = `${Math.random() * 100}%`;
    span.style.fontSize        = `${1.5 + Math.random() * 2}rem`;
    span.style.animationDelay    = `${Math.random() * 3}s`;
    span.style.animationDuration = `${2 + Math.random() * 3}s`;
    container.appendChild(span);
  }
  setTimeout(() => container.remove(), 7000);
}

/** Show a full-board celebration overlay for any winner. */
function showWinCelebration(winnerName, cardNumber, rank = 1, emoji = '🎊') {
  if (rank === 1) {
    winOverlayTitle.textContent = `🎉 ${winnerName} Wins!`;
    winOverlaySub.textContent   = `Card #${cardNumber} got BINGO first!`;
    winOverlay.dataset.rank = '1';
  } else {
    winOverlayTitle.textContent = `🏆 ${winnerName} got BINGO!`;
    winOverlaySub.textContent   = `Card #${cardNumber} is #${rank}!`;
    winOverlay.dataset.rank = String(rank);
  }
  winOverlay.classList.add('visible');
  startEmojiRain(emoji);
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
