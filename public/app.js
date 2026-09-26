const $ = id => document.getElementById(id);
const basePath = '/square-game';
const apiOrigin = window.SQUARE_GAME_API_ORIGIN || location.origin;
const accountRoute = location.pathname.replace(/\/$/, '') === `${basePath}/account`;
if (accountRoute) {
  document.body.classList.add('account-route');
  document.getElementById('account-page-profile').append(document.getElementById('account-panel'));
  document.getElementById('landing').classList.add('hidden');
  document.getElementById('account-page').classList.remove('hidden');
}
let room = null;
let roomId = location.pathname.match(/^\/square-game\/room\/([\w-]+)$/)?.[1] ?? null;
let playerToken = null;
let accountToken = localStorage.getItem('square-account-token');
let signedInEmail = null;
let selected = null;
let staged = [];
let previewStatus = { status: 'empty', message: 'Place tiles to preview your score.' };
let previewRevision = 0;
let tradeIds = new Set();
let timerSeconds = 120;
let busy = false;
const symbols = { circle: '●', square: '■', triangle: '▲', star: '✦' };

function show(id, yes) { $(id).classList.toggle('hidden', !yes); }
function setError(id, message = '') { $(id).textContent = message; }
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function cardElement(card, selectedCard = false, preview = false, recent = false) {
  const node = element('span', `tile ${card.wild ? 'wild' : card.color}${selectedCard ? ' selected' : ''}${preview ? ' preview' : ''}${recent ? ' recent' : ''}`);
  const face = card.wild ? (card.as ? symbols[card.as.shape] : '✳') : symbols[card.shape];
  node.append(element('span', '', face));
  if (!card.wild) node.append(element('small', '', String(card.number)));
  node.title = card.wild ? 'Wild card' + (card.as ? ` (${card.as.color} ${card.as.shape} ${card.as.number})` : '') : `${card.color} ${card.shape} ${card.number}`;
  return node;
}
async function api(path, options = {}) {
  if (!window.SQUARE_GAME_API_ORIGIN && /^\/?(?:www\.)?nathanielmann\.ca$/i.test(location.hostname)) {
    throw new Error('Game API is not configured. Set GAME_API_ORIGIN on the homepage Render service and redeploy it.');
  }
  const response = await fetch(new URL(basePath + path, apiOrigin), {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(playerToken ? { authorization: `Bearer ${playerToken}` } : {}), ...(accountToken ? { 'x-account-token': accountToken } : {}), ...options.headers }
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Game server returned ${raw ? 'a non-JSON response' : 'an empty response'} (HTTP ${response.status}). Check GAME_API_ORIGIN and the game service logs.`); }
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; }
  return data;
}
function setRoom(data, newToken) {
  room = data.room;
  roomId = room.id;
  if (newToken) {
    playerToken = newToken;
    localStorage.setItem(`square-token-${roomId}`, playerToken);
  }
  history.replaceState(null, '', `${basePath}/room/${roomId}`);
  render();
}
function formatTimer(seconds) {
  if (seconds < 86400) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`;
}
function currentIsYou() { return room?.players[room.current]?.isYou; }
function render() {
  show('account-panel', !roomId);
  show('landing', !roomId && !accountRoute);
  show('account-page', !roomId && accountRoute);
  show('room', Boolean(roomId));
  if (!room) return;
  $('room-code').textContent = room.id;
  $('room-heading').textContent = room.status === 'waiting' ? 'Waiting for a friend' : room.status === 'finished' ? 'Game complete' : room.status === 'paused' ? 'Game paused' : currentIsYou() ? 'Your move' : `${room.players[room.current]?.name}'s move`;
  $('room-subtitle').textContent = `${formatTimer(room.timerSeconds)} per turn · ${room.players.length}/2 players`;
  show('join-panel', room.status === 'waiting' && !room.players.some(p => p.isYou));
  show('waiting-panel', room.status === 'waiting' && room.players.some(p => p.isYou));
  show('invite-panel', room.status === 'waiting' && Boolean(room.invites));
  if (room.invites) {
    show('host-email-field', !room.hostHasEmail);
    $('invite-status').textContent = room.invites.length ? `Invite sent to ${room.invites.join(', ')}. We'll email you when they accept.` : '';
  }
  show('delete-room', room.status === 'waiting' && room.players.length === 1 && room.players[0].isYou);
  show('room-sign-in', room.timerSeconds >= 86400 && !room.players.some(p => p.isYou));
  $('join-button').disabled = room.timerSeconds >= 86400 && !accountToken;
  renderPauseControls();
  show('game-panel', room.status !== 'waiting');
  if (room.status === 'waiting') return;
  renderScores(); renderBoard(); renderHand(); renderStaged(); renderLastMove(); updateCountdown();
}
function useAccount(email) {
  signedInEmail = email;
  for (const id of ['host-email']) {
    $(id).value = email;
    $(id).readOnly = true;
  }
  const savedName = localStorage.getItem('square-player-name');
  if (savedName) for (const id of ['create-name', 'join-name']) if (!$(id).value) $(id).value = savedName;
}
async function refreshAccount() {
  if (!accountToken) {
    show('account-sign-in', true); show('account-profile', false);
    show('account-history', false);
    return;
  }
  try {
    const data = await api('/api/account/me');
    useAccount(data.email);
    show('account-sign-in', false); show('account-profile', true);
    show('account-history', true);
    $('account-identity').textContent = data.email;
    $('account-win-percent').textContent = `${data.winPercent}%`;
    $('account-games-played').textContent = String(data.gamesPlayed);
    $('account-current-count').textContent = String(data.currentGames.length);
    const list = $('account-current-games'); list.replaceChildren();
    if (!data.currentGames.length) list.append(element('p', 'fine', 'No games in progress yet.'));
    for (const game of data.currentGames) {
      const link = element('a'); link.href = `${basePath}/room/${game.id}`;
      link.append(element('span', '', `Room ${game.id} · ${game.opponent}`),
        element('small', '', game.status === 'waiting' ? 'Waiting for a friend' : game.status === 'paused' ? 'Paused' : game.yourTurn ? 'Your turn' : "Opponent's turn"));
      list.append(link);
    }
    const finished = $('account-finished-games'); finished.replaceChildren();
    if (!data.finishedGames?.length) finished.append(element('p', 'fine', 'No completed games yet.'));
    for (const game of data.finishedGames || []) {
      const link = element('a'); link.href = `${basePath}/room/${game.id}`;
      const result = game.outcome === 'win' ? 'Won' : game.outcome === 'loss' ? 'Lost' : 'Tied';
      const reason = game.finishReason === 'missed-turns' ? ' · missed turns' : '';
      const date = game.finishedAt ? new Date(game.finishedAt).toLocaleDateString() : '';
      link.append(element('span', '', `Room ${game.id} · ${game.opponent}`),
        element('small', '', `${result} ${game.yourScore}–${game.opponentScore}${reason}${date ? ` · ${date}` : ''}`));
      finished.append(link);
    }
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem('square-account-token'); accountToken = null; signedInEmail = null;
      show('account-sign-in', true); show('account-profile', false);
      show('account-history', false);
      $('account-error').textContent = 'Your sign-in expired. Request a new code.';
    } else $('account-error').textContent = error.message;
  }
}
async function linkSavedRooms() {
  if (!accountToken) return;
  const saved = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (/^square-token-\d{4}$/.test(key)) saved.push([key.slice('square-token-'.length), localStorage.getItem(key)]);
  }
  for (const [id, token] of saved) {
    try { await api(`/api/rooms/${id}/link-account`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }); }
    catch { /* Stale or differently owned room links stay untouched. */ }
  }
}
function renderScores() {
  const parent = $('players'); parent.replaceChildren();
  room.players.forEach((player, index) => {
    const pill = element('div', `player-pill${index === room.current && room.status === 'playing' ? ' current' : ''}`);
    pill.append(element('small', '', `${player.name}${player.isYou ? ' · you' : ''} · ${player.cardCount} cards`), element('strong', '', `${player.score} pts`));
    parent.append(pill);
  });
  $('turn-label').textContent = room.status === 'finished' ? 'FINAL SCORE' : 'TIME REMAINING';
  $('deck-count').textContent = `${room.deckCount} cards in draw pile`;
}
function renderLastMove() {
  show('last-move', Boolean(room.lastMove));
  if (room.lastMove) $('last-move').textContent = `${room.lastMove.playerName} ${room.lastMove.kind === 'play' ? 'played' : room.lastMove.kind === 'timeout' ? 'timed out' : 'passed'} · +${room.lastMove.points} points${room.lastMove.lots ? ` · ${room.lastMove.lots} lot${room.lastMove.lots === 1 ? '' : 's'} ×${2 ** room.lastMove.lots}` : ''}`;
}
function renderBoard() {
  const parent = $('board'); parent.replaceChildren();
  const positions = Object.keys(room.board).concat(staged.map(p => `${p.x},${p.y}`)).map(value => value.split(',').map(Number));
  let xs = positions.map(p => p[0]), ys = positions.map(p => p[1]);
  const minX = Math.min(-3, ...xs) - 2, maxX = Math.max(3, ...xs) + 2;
  const minY = Math.min(-3, ...ys) - 2, maxY = Math.max(3, ...ys) + 2;
  parent.style.gridTemplateColumns = `repeat(${maxX - minX + 1}, auto)`;
  // Highlight the cards the other player placed on their last move.
  const you = room.players.find(p => p.isYou)?.id;
  const recent = new Set(room.lastMove && room.lastMove.playerId !== you ? room.lastMove.cells ?? [] : []);
  const fragment = document.createDocumentFragment();
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const key = `${x},${y}`;
    const existing = room.board[key];
    const preview = staged.find(p => p.x === x && p.y === y);
    const cell = element('button', `cell ${existing || preview ? 'occupied' : 'empty'}`);
    cell.type = 'button';
    cell.setAttribute('aria-label', existing ? `Board card ${existing.wild ? 'wild' : `${existing.color} ${existing.shape} ${existing.number}`} at ${x}, ${y}` : `Empty position ${x}, ${y}`);
    if (existing) cell.append(cardElement(existing, false, false, recent.has(key)));
    else if (preview) {
      const tile = cardElement(preview.card, false, true);
      if (previewStatus.status === 'legal' || previewStatus.status === 'illegal') tile.classList.add(previewStatus.status);
      cell.append(tile);
    }
    cell.addEventListener('click', () => boardClick(x, y, existing));
    fragment.append(cell);
  }
  parent.append(fragment);
}
function renderHand() {
  const parent = $('hand'); parent.replaceChildren();
  const canAct = room.status === 'playing' && currentIsYou();
  room.hand.forEach(card => {
    const button = element('button'); button.type = 'button';
    button.disabled = !canAct || staged.some(p => p.cardId === card.id);
    button.append(cardElement(card, selected === card.id || tradeIds.has(card.id)));
    button.addEventListener('click', () => {
      if ($('trade-mode').checked) {
        if (tradeIds.has(card.id)) tradeIds.delete(card.id); else tradeIds.add(card.id);
      } else selected = selected === card.id ? null : card.id;
      renderHand(); renderControls();
    });
    parent.append(button);
  });
  $('hand-help').textContent = canAct ? ($('trade-mode').checked ? 'Select cards to exchange, then pass.' : 'Select a card, then choose an empty square.') : 'Your cards stay private until your turn.';
  renderControls();
}
function renderStaged() {
  $('staged').textContent = staged.length ? `${staged.length} card${staged.length === 1 ? '' : 's'} staged: ${staged.map(p => `(${p.x}, ${p.y})`).join(', ')}` : room.pendingSwap ? `Wild exchanged · base ${room.pendingSwap.base}, ${room.pendingSwap.lots} lot(s). Now play your turn.` : 'No cards staged.';
  updatePreview();
}
function showPreview() {
  const node = $('move-preview');
  node.className = `move-preview ${previewStatus.status}`;
  node.textContent = previewStatus.message;
  renderControls();
}
async function updatePreview() {
  const revision = ++previewRevision;
  if (!staged.length) {
    previewStatus = { status: 'empty', message: 'Place tiles to preview your score.' };
    showPreview();
    renderBoard();
    return;
  }
  previewStatus = { status: 'checking', message: 'Checking move…' };
  showPreview();
  renderBoard();
  try {
    const result = await api(`/api/rooms/${roomId}/preview`, {
      method: 'POST', body: JSON.stringify({ placements: staged.map(({ card, ...place }) => place) })
    });
    if (revision !== previewRevision) return;
    if (result.legal) {
      const currentScore = room.players.find(player => player.isYou)?.score ?? 0;
      previewStatus = { status: 'legal', message: `This move: +${result.points} pts · Total if played: ${currentScore + result.points} pts` };
    } else previewStatus = { status: 'illegal', message: `Illegal move: ${result.reason}` };
  } catch (error) {
    if (revision !== previewRevision) return;
    previewStatus = { status: 'unavailable', message: `Could not check move: ${error.message}` };
  }
  showPreview();
  renderBoard();
}
function renderControls() {
  if (room) renderPauseControls();
  const canAct = room?.status === 'playing' && currentIsYou() && !busy;
  $('play-button').disabled = !canAct || previewStatus.status !== 'legal';
  $('pass-button').disabled = !canAct;
  $('undo-button').disabled = !canAct || staged.length === 0;
  $('pass-button').textContent = $('trade-mode').checked && tradeIds.size ? `Trade ${tradeIds.size} and pass` : 'Pass turn';
}
function boardClick(x, y, existing) {
  if (!room || room.status !== 'playing' || !currentIsYou() || busy || !selected || $('trade-mode').checked) return;
  const card = room.hand.find(item => item.id === selected);
  if (!card) return;
  if (existing?.wild && !staged.length && !room.pendingSwap && !card.wild) {
    act({ type: 'swap', x, y, cardId: card.id });
    return;
  }
  if (existing || staged.some(p => p.x === x && p.y === y) || staged.length === 4) return;
  staged.push({ x, y, cardId: card.id, card });
  selected = null;
  renderBoard(); renderHand(); renderStaged();
}
function renderPauseControls() {
  const index = room.players.findIndex(player => player.isYou);
  const visible = index >= 0 && ['playing', 'paused'].includes(room.status);
  show('pause-controls', visible);
  if (!visible) return;
  const requested = room.pauseRequestedBy != null;
  const mine = room.pauseRequestedBy === index;
  const accepted = room.resumeAccepted.includes(index);
  $('pause-status').textContent = room.status === 'paused'
    ? accepted ? 'Waiting for your opponent to resume.' : 'Game paused. Both players must agree to resume.'
    : requested ? mine ? 'Pause requested. The timer runs until your opponent accepts.' : 'Your opponent requested a pause. The timer is still running.' : 'Both players must agree to pause.';
  $('pause-button').textContent = room.status === 'paused' ? 'Agree to resume' : requested ? mine ? 'Pause requested' : 'Accept pause' : 'Request pause';
  $('pause-button').disabled = busy || (room.status === 'paused' ? accepted : requested && mine);
  show('cancel-pause', room.status === 'playing' && requested);
  $('cancel-pause').textContent = mine ? 'Cancel request' : 'Decline pause';
  $('cancel-pause').disabled = busy;
}
$('pause-button').addEventListener('click', () => act({ type: room.status === 'paused' ? 'resume' : room.pauseRequestedBy != null ? 'accept-pause' : 'request-pause' }));
$('cancel-pause').addEventListener('click', () => act({ type: 'cancel-pause' }));
$('delete-room').addEventListener('click', async () => {
  if (busy) return;
  busy = true; $('delete-room').disabled = true;
  try {
    await api(`/api/rooms/${roomId}`, { method: 'DELETE' });
    localStorage.removeItem(`square-token-${roomId}`);
    location.assign(basePath);
  } catch (error) { setError('room-error', error.message); }
  finally { busy = false; $('delete-room').disabled = false; }
});
async function act(input) {
  if (busy) return;
  busy = true; renderControls(); setError('room-error');
  try {
    const data = await api(`/api/rooms/${roomId}/action`, { method: 'POST', body: JSON.stringify(input) });
    if (input.type !== 'swap') { staged = []; tradeIds.clear(); $('trade-mode').checked = false; }
    selected = null;
    setRoom(data);
    if (data.notificationSent === false && room.timerSeconds >= 86400 && room.status === 'playing') setError('room-error', 'Move saved, but the email could not be sent. Share the invite link with your opponent.');
  } catch (error) {
    setError('room-error', error.message);
    await refresh();
  } finally { busy = false; renderControls(); }
}
function updateCountdown() {
  if (!room || room.status === 'waiting') return;
  if (room.status === 'finished') { $('countdown').textContent = room.finishReason === 'missed-turns' ? 'Tie · missed turns' : room.winner ? `${room.players.find(p => p.id === room.winner)?.name} wins` : 'Tie game'; return; }
  if (room.status === 'paused') { $('countdown').textContent = 'Paused'; return; }
  const left = Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000));
  const days = Math.floor(left / 86400), hours = Math.floor((left % 86400) / 3600), minutes = Math.floor((left % 3600) / 60), seconds = left % 60;
  $('countdown').textContent = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
async function refresh() {
  if (!roomId || busy) return;
  accountToken = localStorage.getItem('square-account-token');
  try { room = (await api(`/api/rooms/${roomId}`)).room; render(); setError('room-error'); }
  catch (error) { setError('room-error', error.message); }
}

$('timer-slider').addEventListener('input', event => {
  timerSeconds = Number(event.target.value) * 60;
  $('minute-label').textContent = formatTimer(timerSeconds);
  document.querySelectorAll('[data-days]').forEach(button => button.classList.remove('active'));
});
document.querySelectorAll('[data-days]').forEach(button => button.addEventListener('click', () => {
  timerSeconds = Number(button.dataset.days) * 86400;
  $('minute-label').textContent = formatTimer(timerSeconds);
  document.querySelectorAll('[data-days]').forEach(item => item.classList.toggle('active', item === button));
}));
$('create-button').addEventListener('click', async () => {
  setError('setup-error');
  try {
    const data = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: $('create-name').value, timerSeconds }) });
    localStorage.setItem('square-player-name', $('create-name').value.trim());
    setRoom(data, data.token);
  } catch (error) { setError('setup-error', error.message); }
});
$('join-button').addEventListener('click', async () => {
  setError('room-error');
  try {
    const data = await api(`/api/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ name: $('join-name').value }) });
    localStorage.setItem('square-player-name', $('join-name').value.trim());
    setRoom(data, data.token);
  } catch (error) { setError('room-error', error.message); }
});
$('invite-button').addEventListener('click', async () => {
  setError('invite-error');
  $('invite-button').disabled = true;
  try {
    const data = await api(`/api/rooms/${roomId}/invite`, { method: 'POST', body: JSON.stringify({ email: $('invite-email').value, yourEmail: $('host-email').value }) });
    $('invite-email').value = '';
    setRoom(data);
  } catch (error) { setError('invite-error', error.message); }
  finally { $('invite-button').disabled = false; }
});
async function joinByCode() {
  setError('join-code-error');
  const code = $('join-code-input').value.trim();
  if (!/^\d{4}$/.test(code)) return setError('join-code-error', 'Enter the 4-digit room code.');
  playerToken = localStorage.getItem(`square-token-${code}`);
  try { setRoom(await api(`/api/rooms/${code}`)); }
  catch (error) { playerToken = null; setError('join-code-error', error.message); }
}
$('join-code-button').addEventListener('click', joinByCode);
$('join-code-input').addEventListener('keydown', event => { if (event.key === 'Enter') joinByCode(); });
$('copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`${location.origin}${basePath}/room/${roomId}`); $('copy-status').textContent = 'Invite link copied'; }
  catch { $('copy-status').textContent = 'Copy the room URL from your browser'; }
});
$('play-button').addEventListener('click', () => act({ type: 'play', placements: staged.map(({ card, ...place }) => place) }));
$('undo-button').addEventListener('click', () => { staged.pop(); renderBoard(); renderHand(); renderStaged(); });
$('pass-button').addEventListener('click', () => act({ type: 'pass', tradeIds: $('trade-mode').checked ? [...tradeIds] : [] }));
$('trade-mode').addEventListener('change', () => { selected = null; tradeIds.clear(); renderHand(); });

$('code-request-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  setError('account-error'); $('account-message').textContent = 'Sending code…';
  try {
    await api('/api/account/request-code', { method: 'POST', body: JSON.stringify({ email: $('account-email').value }) });
    show('code-verify-form', true);
    $('account-code').focus();
    $('account-message').textContent = 'Check your email for a six-digit code. It expires in 10 minutes.';
  } catch (error) { $('account-message').textContent = ''; setError('account-error', error.message); }
  finally { button.disabled = false; }
});
$('code-verify-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  setError('account-error');
  try {
    const result = await api('/api/account/verify-code', { method: 'POST', body: JSON.stringify({ email: $('account-email').value, code: $('account-code').value }) });
    accountToken = result.token;
    localStorage.setItem('square-account-token', accountToken);
    $('account-code').value = '';
    show('code-verify-form', false);
    $('account-message').textContent = '';
    await linkSavedRooms();
    await refreshAccount();
    if (roomId) await refresh();
  } catch (error) { setError('account-error', error.message); }
  finally { button.disabled = false; }
});
$('account-sign-out').addEventListener('click', () => {
  const email = signedInEmail;
  localStorage.removeItem('square-account-token'); accountToken = null; signedInEmail = null;
  for (const id of ['host-email']) {
    $(id).readOnly = false;
    if ($(id).value === email) $(id).value = '';
  }
  show('account-sign-in', true); show('account-profile', false);
  show('account-history', false);
  setError('account-error');
});

if (roomId) {
  const queryToken = new URLSearchParams(location.search).get('token');
  playerToken = queryToken || localStorage.getItem(`square-token-${roomId}`);
  if (queryToken) { localStorage.setItem(`square-token-${roomId}`, queryToken); history.replaceState(null, '', `${basePath}/room/${roomId}`); }
  refresh();
}
if (accountToken && roomId && playerToken) linkSavedRooms().then(refreshAccount);
else refreshAccount();
setInterval(updateCountdown, 1000);
setInterval(refresh, 10000);
