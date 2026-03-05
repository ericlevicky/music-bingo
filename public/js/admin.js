/* admin.js – Admin page logic */
'use strict';

const socket = io();

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const gameStatusEl      = document.getElementById('game-status');
const spotifyBadge      = document.getElementById('spotify-badge');
const spotifyBtn        = document.getElementById('spotify-btn');
const spotifyMsg        = document.getElementById('spotify-status-msg');
const playlistSelect    = document.getElementById('playlist-select');
const refreshBtn        = document.getElementById('refresh-playlists-btn');
const playlistInfo      = document.getElementById('playlist-info');
const contactsInput     = document.getElementById('contacts-input');
const cardsPerContact   = document.getElementById('cards-per-contact');
const totalCardsPreview = document.getElementById('total-cards-preview');
const generateBtn       = document.getElementById('generate-btn');
const generateMsg       = document.getElementById('generate-msg');
const cardListSection   = document.getElementById('card-list-section');
const cardListEl        = document.getElementById('card-list');
const startBtn          = document.getElementById('start-btn');
const endBtn            = document.getElementById('end-btn');
const resetBtn          = document.getElementById('reset-btn');
const gameMsg           = document.getElementById('game-msg');
const nowPlaying        = document.getElementById('now-playing');
const npArt             = document.getElementById('np-art');
const npTitle           = document.getElementById('np-title');
const npArtist          = document.getElementById('np-artist');
const playedList        = document.getElementById('played-list');
const noSongsMsg        = document.getElementById('no-songs-msg');
const winnersTable      = document.getElementById('winners-table');
const winnersBody       = document.getElementById('winners-body');
const noWinnersMsg      = document.getElementById('no-winners-msg');
const globalAlert       = document.getElementById('global-alert');
const adminPic          = document.getElementById('admin-pic');
const adminName         = document.getElementById('admin-name');
const optSongHistory    = document.getElementById('opt-song-history');
const optNowPlaying     = document.getElementById('opt-now-playing');
const optHint           = document.getElementById('opt-hint');
const optStrictValid    = document.getElementById('opt-strict-validation');
const optFreeSpace      = document.getElementById('opt-free-space');
const optBingoMode      = document.getElementById('opt-bingo-mode');
const optionsMsg        = document.getElementById('options-msg');

// ─── Admin profile ────────────────────────────────────────────────────────────
let currentAdminId = null;
let currentGameId  = null;

async function loadProfile() {
  try {
    const res  = await fetch('/api/admin/profile');
    if (res.status === 401 || res.redirected) { window.location.href = '/login'; return; }
    const data = await res.json();

    currentAdminId = data.googleId;
    currentGameId  = data.game.gameId;
    adminName.textContent = data.name || data.email;
    if (data.picture) {
      adminPic.src = data.picture;
      adminPic.style.display = '';
    }

    updateSpotifyBadge(data.spotifyConnected);
    updateGameStatus(data.game.status);
    updateQrDisplayLink();

    // Restore state from existing game
    if (data.game.playedSongs && data.game.playedSongs.length) {
      data.game.playedSongs.forEach(addPlayedSong);
    }
    if (data.game.winners && data.game.winners.length) {
      data.game.winners.forEach((w, i) => addWinnerRow(w, i + 1));
    }
    if (data.game.cardCount > 0) {
      const cardsRes = await fetch('/api/cards');
      renderCardList(await cardsRes.json());
    }

    // Sync player screen option checkboxes
    if (data.game.playerOptions) {
      syncOptionCheckboxes(data.game.playerOptions);
    }

    // Load playlists if Spotify is connected
    if (data.spotifyConnected) loadPlaylists();

    // Join the admin's game room
    if (data.game.gameId) {
      socket.emit('admin:join', { googleId: currentAdminId });
    }
  } catch (err) {
    setAlert(globalAlert, 'Failed to load profile: ' + err.message, 'error');
  }
}

// ─── Auth feedback from URL params ────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
if (params.get('spotify_success')) {
  spotifyMsg.innerHTML = `<div class="alert alert-success">✓ Spotify connected!</div>`;
  history.replaceState({}, '', '/admin');
}
if (params.get('spotify_error')) {
  spotifyMsg.innerHTML = `<div class="alert alert-error">Spotify error: ${params.get('spotify_error')}</div>`;
  history.replaceState({}, '', '/admin');
}

// ─── Spotify badge ────────────────────────────────────────────────────────────
function updateSpotifyBadge(connected) {
  if (connected) {
    spotifyBadge.innerHTML = '<span style="color:var(--green);">✓ Spotify connected</span>';
    spotifyBtn.textContent = '✓ Reconnect Spotify';
  } else {
    spotifyBadge.innerHTML = '<span style="color:var(--text-m);">Spotify not connected</span>';
  }
}

// ─── Playlist picker ──────────────────────────────────────────────────────────
async function loadPlaylists() {
  refreshBtn.disabled = true;
  try {
    const res  = await fetch('/api/admin/playlists');
    if (!res.ok) {
      const d = await res.json();
      setAlert(generateMsg, d.error, 'error');
      return;
    }
    const playlists = await res.json();
    playlistSelect.innerHTML = playlists.length === 0
      ? '<option value="">No playlists found on your Spotify account</option>'
      : '<option value="">— Select a playlist —</option>' +
        playlists.map(p =>
          `<option value="${escAttr(p.id)}">${escHtml(p.name)} (${p.trackCount} tracks)</option>`
        ).join('');
  } catch (err) {
    setAlert(generateMsg, 'Failed to load playlists: ' + err.message, 'error');
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener('click', loadPlaylists);

playlistSelect.addEventListener('change', () => {
  const opt = playlistSelect.options[playlistSelect.selectedIndex];
  if (!opt || !opt.value) { playlistInfo.textContent = ''; return; }
  playlistInfo.textContent = `Selected: "${opt.text}"`;
});

// ─── Contacts / total cards preview ──────────────────────────────────────────
function parseContacts() {
  const lines            = contactsInput.value.split('\n').map(l => l.trim()).filter(Boolean);
  const countPerContact  = parseInt(cardsPerContact.value, 10) || 1;
  return lines.map(v => ({ value: v, count: countPerContact }));
}

function updatePreview() {
  const contacts = parseContacts();
  const total    = contacts.reduce((s, c) => s + c.count, 0);
  totalCardsPreview.textContent = `${total} card${total !== 1 ? 's' : ''} total`;
}

contactsInput.addEventListener('input', updatePreview);
cardsPerContact.addEventListener('input', updatePreview);

// ─── Generate cards ───────────────────────────────────────────────────────────
generateBtn.addEventListener('click', async () => {
  const playlistId = playlistSelect.value;
  if (!playlistId) { setAlert(generateMsg, 'Please select a playlist.', 'error'); return; }

  const contacts = parseContacts();
  if (contacts.length === 0) {
    setAlert(generateMsg, 'Please enter at least one contact (email or phone).', 'error');
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';
  setAlert(generateMsg, '', '');

  try {
    const res  = await fetch('/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ playlistId, contacts }),
    });
    const data = await res.json();

    if (!res.ok) { setAlert(generateMsg, data.error, 'error'); return; }

    setAlert(generateMsg, `✓ ${data.message} (${data.songCount} songs in playlist)`, 'success');
    renderCardList(data.cards);

    // Join the new game room
    socket.emit('admin:join', { googleId: currentAdminId });
  } catch (err) {
    setAlert(generateMsg, 'Network error: ' + err.message, 'error');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate cards';
  }
});

function renderCardList(cards) {
  cardListEl.innerHTML = cards.map(c => {
    const fullUrl = window.location.origin + c.url;
    let shareBtn = '';

    if (c.contact && c.contact.type === 'phone') {
      const raw   = c.contact.value.trim();
      const phone = (raw.startsWith('+') ? '+' : '') + raw.replace(/\D/g, '');
      const msg   = encodeURIComponent(`Your Music Bingo card is ready! Tap to play: ${fullUrl}`);
      shareBtn = `<a href="sms:${escAttr(phone)}?body=${msg}" class="share-btn" title="Send text to ${escAttr(c.contact.value)}">💬</a>`;
    } else if (c.contact && c.contact.type === 'email') {
      const subject = encodeURIComponent('Your Music Bingo Card');
      const body    = encodeURIComponent(`Hi,\n\nYour Music Bingo card is ready! Click the link below to play:\n\n${fullUrl}\n\nGood luck and have fun!`);
      shareBtn = `<a href="mailto:${escAttr(c.contact.value)}?subject=${subject}&body=${body}" class="share-btn" title="Send email to ${escAttr(c.contact.value)}">✉️</a>`;
    }

    const contactLabel = c.contact
      ? ` <span class="card-contact-label">(${escHtml(c.contact.value)})</span>`
      : '';
    return `<span class="card-list-item"><a href="${escAttr(c.url)}" target="_blank">Card #${c.number}${contactLabel}</a>${shareBtn}</span>`;
  }).join('');
  cardListSection.style.display = 'block';
}

// ─── Game controls ────────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  const res  = await fetch('/api/game/start', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { setAlert(gameMsg, data.error, 'error'); return; }
  setAlert(gameMsg, '▶ Game started!', 'success');
  socket.emit('admin:join', { googleId: currentAdminId });
});

endBtn.addEventListener('click', async () => {
  if (!confirm('End the game?')) return;
  const res  = await fetch('/api/game/end', { method: 'POST' });
  const data = await res.json();
  setAlert(gameMsg, data.message, 'info');
});

resetBtn.addEventListener('click', async () => {
  if (!confirm(
    'Reset game progress?\n\n' +
    '• Played songs and winners will be cleared\n' +
    '• Player links stay valid – existing card boards are kept\n' +
    '• Players\' marked cells will be cleared\n' +
    '• Bingo mode resets to "Any Line"\n\n' +
    'Note: generating new cards (Step 2) creates entirely new boards and invalidates old player links.'
  )) return;
  await fetch('/api/game/reset', { method: 'POST' });
  playedList.innerHTML  = '';
  playedList.style.display = 'none';
  noSongsMsg.style.display = 'block';
  winnersBody.innerHTML = '';
  winnersTable.style.display = 'none';
  noWinnersMsg.style.display = 'block';
  nowPlaying.style.display = 'none';
  setAlert(gameMsg, 'Game reset. Player links are still valid — boards are unchanged, marked cells cleared.', 'info');
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function updateGameStatus(status) {
  const labels  = { idle: 'Idle', active: '● Active', ended: 'Ended' };
  const classes = { idle: 'status-idle', active: 'status-active', ended: 'status-ended' };
  gameStatusEl.textContent = labels[status] || status;
  gameStatusEl.className   = `status-pill ${classes[status] || 'status-idle'}`;
  startBtn.disabled = status === 'active';
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
  winnersBody.appendChild(tr);
  winnersTable.style.display = 'table';
  noWinnersMsg.style.display = 'none';
}

function addPlayedSong(song) {
  noSongsMsg.style.display = 'none';
  playedList.style.display = '';
  const li = document.createElement('li');
  li.textContent = `${song.name} – ${song.artists}`;
  playedList.appendChild(li);
}

function setAlert(el, msg, type) {
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

// ─── Player screen options ────────────────────────────────────────────────────
function syncOptionCheckboxes(opts) {
  if (typeof opts.showSongHistory   === 'boolean') optSongHistory.checked = opts.showSongHistory;
  if (typeof opts.showNowPlaying    === 'boolean') optNowPlaying.checked  = opts.showNowPlaying;
  if (typeof opts.showHint          === 'boolean') optHint.checked        = opts.showHint;
  if (typeof opts.strictValidation  === 'boolean') optStrictValid.checked = opts.strictValidation;
  if (typeof opts.freeSpace         === 'boolean') optFreeSpace.checked   = opts.freeSpace;
  if (typeof opts.bingoMode         === 'string')  optBingoMode.value     = opts.bingoMode;
}

async function savePlayerOptions() {
  try {
    const res = await fetch('/api/game/options', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        showSongHistory:  optSongHistory.checked,
        showNowPlaying:   optNowPlaying.checked,
        showHint:         optHint.checked,
        strictValidation: optStrictValid.checked,
        freeSpace:        optFreeSpace.checked,
        bingoMode:        optBingoMode.value,
      }),
    });
    if (!res.ok) {
      const d = await res.json();
      setAlert(optionsMsg, d.error || 'Failed to save options.', 'error');
    } else {
      setAlert(optionsMsg, '✓ Options saved.', 'success');
      setTimeout(() => setAlert(optionsMsg, '', ''), 2000);
    }
  } catch (err) {
    setAlert(optionsMsg, 'Network error: ' + err.message, 'error');
  }
}

[optSongHistory, optNowPlaying, optHint, optStrictValid, optFreeSpace].forEach((cb) => {
  cb.addEventListener('change', savePlayerOptions);
});
optBingoMode.addEventListener('change', savePlayerOptions);

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('game:state', (state) => {
  currentGameId = state.gameId;
  updateGameStatus(state.status);
  updateQrDisplayLink();
  if (state.currentSong) {
    npArt.src = state.currentSong.albumArt || '';
    npTitle.textContent  = state.currentSong.name;
    npArtist.textContent = state.currentSong.artists;
    nowPlaying.style.display = 'flex';
  }
});

socket.on('game:started', (state) => { updateGameStatus(state.status); });
socket.on('game:ended',   (state) => {
  updateGameStatus(state.status);
  nowPlaying.style.display = 'none';
});
socket.on('game:reset',   ()      => { updateGameStatus('idle'); });

socket.on('song:playing', ({ song, previousSong }) => {
  if (previousSong) addPlayedSong(previousSong);
  npArt.src = song.albumArt || '';
  npTitle.textContent  = song.name;
  npArtist.textContent = song.artists;
  nowPlaying.style.display = 'flex';
});

socket.on('song:paused', (data = {}) => {
  if (data && data.finishedSong) addPlayedSong(data.finishedSong);
  nowPlaying.style.display = 'none';
});

socket.on('bingo:claimed', (w) => {
  addWinnerRow(w, w.rank);
  if (w.rank === 1) {
    setAlert(globalAlert,
      `🏆 <strong>${escHtml(w.playerName)}</strong> got BINGO! (Card #${w.cardNumber})`,
      'success');
  }
});

socket.on('player:joined', (card) => {
  const contactLabel = card.contact
    ? ` <span class="card-contact-label">(${escHtml(card.contact.value)})</span>`
    : '';
  const item = document.createElement('span');
  item.className = 'card-list-item';
  item.innerHTML = `<a href="${escAttr(card.url)}" target="_blank">Card #${card.number}${contactLabel}</a>`;
  cardListEl.appendChild(item);
  cardListSection.style.display = 'block';
});

// ─── QR code modal ────────────────────────────────────────────────────────────
const qrModal      = document.getElementById('qr-modal');
const qrImg        = document.getElementById('qr-img');
const qrUrlEl      = document.getElementById('qr-url');
const qrClose      = document.getElementById('qr-close');
const gameQrBtn    = document.getElementById('game-qr-btn');
const qrDisplayLink = document.getElementById('qr-display-link');

function openQrModal() {
  if (!currentGameId) {
    setAlert(globalAlert, 'Generate bingo cards before showing the QR code.', 'error');
    return;
  }
  qrImg.src = '/api/qr';
  qrUrlEl.textContent = window.location.origin + '/?game=' + currentGameId;
  qrModal.style.display = 'flex';
}

function updateQrDisplayLink() {
  if (currentGameId) {
    qrDisplayLink.href = `/qr?game=${encodeURIComponent(currentGameId)}`;
  }
}

gameQrBtn.addEventListener('click', openQrModal);
qrClose.addEventListener('click', () => { qrModal.style.display = 'none'; });
qrModal.addEventListener('click', (e) => { if (e.target === qrModal) qrModal.style.display = 'none'; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') qrModal.style.display = 'none'; });

// ─── Init ─────────────────────────────────────────────────────────────────────
loadProfile();
