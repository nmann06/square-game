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
const blankProfile = () => ({ name: '', color: '#285b36', language: 'en', tileColors: null });
let savedProfile = blankProfile();
let accountData = null;
let editingAccount = false;
let guestMode = sessionStorage.getItem('square-guest-mode') === 'true';
let selected = null;
let staged = [];
let previewStatus = { status: 'empty' };
let previewRevision = 0;
let tradeIds = new Set();
let timerSeconds = 120;
let gameMode = 'friend';
let busy = false;
let reviewTurn = null;
let reviewRoomId = null;
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
  node.title = describeCard(card);
  return node;
}
function describeCard(card) {
  if (!card.wild) return SquareI18n.cardName(card);
  return card.as ? t('card.wildAs', { card: SquareI18n.cardName(card.as) }) : t('card.wild');
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
  if (!response.ok) { const error = new Error(SquareI18n.serverMessage(data.error || 'Request failed.')); error.status = response.status; throw error; }
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
  if (seconds < 86400) return t('time.minutes', { n: seconds / 60 });
  return t('time.days', { n: seconds / 86400 });
}
function currentIsYou() { return room?.players[room.current]?.isYou; }
let heroShuffle = null;
function shuffleHeroCards() {
  if (roomId || accountRoute || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (heroShuffle) return heroShuffle;
  heroShuffle = (async () => {
    const cards = document.querySelector('.hero-tiles');
    const tiles = [...cards.children];
    const center = (tiles[0].offsetLeft + tiles.at(-1).offsetLeft + tiles.at(-1).offsetWidth) / 2;
    const poses = tiles.map((tile, index) => ({
      rest: getComputedStyle(tile).transform,
      x: center - tile.offsetLeft - tile.offsetWidth / 2,
      y: -18 - index * 3,
      side: index % 2 ? 1 : -1
    }));
    const animations = [];
    const pose = (p, dx = 0, dy = 0, angle = -5) => `translate(${p.x + dx}px, ${p.y + dy}px) rotate(${angle}deg) scale(.96)`;
    const play = async (frames, timing) => {
      const batch = tiles.map((tile, index) => tile.animate(frames(poses[index], index), { fill: 'forwards', ...timing(index) }));
      animations.push(...batch);
      await Promise.all(batch.map(animation => animation.finished.catch(() => {})));
    };
    cards.classList.add('is-shuffling');
    try {
      // Gather the fan, then cut and interleave two halves of the deck.
      await play((p, i) => [
        { transform: p.rest, zIndex: i + 1 },
        { transform: pose(p), zIndex: i + 1 }
      ], () => ({ duration: 160, easing: 'cubic-bezier(.4,0,.2,1)' }));
      const split = Math.min(tiles[0].offsetWidth * .65, 70);
      await play((p, i) => [
        { transform: pose(p), zIndex: i + 1, offset: 0 },
        { transform: pose(p, p.side * split, p.side * -18, p.side * 14), zIndex: i + 1, offset: .24 },
        { transform: pose(p, 0, -8, 4), zIndex: 4 - i, offset: .48 },
        { transform: pose(p, -p.side * split * .8, p.side * 14, -p.side * 11), zIndex: 4 - i, offset: .73 },
        { transform: pose(p), zIndex: i + 1, offset: 1 }
      ], () => ({ duration: 360, easing: 'ease-in-out' }));
      cards.classList.add('is-dealing');
      // Peel off the top card first, with a little lift and an overshoot on landing.
      await play((p, i) => [
        { transform: pose(p), zIndex: i + 1, offset: 0 },
        { transform: `translate(${p.x * .5}px, -48px) rotate(${p.side * 16}deg) scale(1.04)`, zIndex: 10 + i, offset: .38 },
        { transform: `translate(${-p.x * .06}px, 4px) ${p.rest}`, zIndex: 10 + i, offset: .8 },
        { transform: p.rest, zIndex: i + 1, offset: 1 }
      ], i => ({ duration: 175, delay: (tiles.length - 1 - i) * 200, easing: 'cubic-bezier(.2,.65,.3,1)' }));
    } finally {
      for (const animation of animations) animation.cancel();
      cards.classList.remove('is-shuffling', 'is-dealing');
    }
  })().finally(() => { heroShuffle = null; });
  return heroShuffle;
}
function renderLanding() {
  renderAccountAppearance();
  if (accountRoute || roomId) return;
  const signedIn = Boolean(signedInEmail);
  const canSetUp = signedIn || guestMode;
  const tutorialDestination = $(canSetUp ? 'setup-tutorial-slot' : 'account-sign-in');
  if ($('tutorial-launcher').parentElement !== tutorialDestination) tutorialDestination.append($('tutorial-launcher'));
  const destination = $(signedIn ? 'hero-account' : 'landing-account');
  if ($('account-panel').parentElement !== destination) destination.append($('account-panel'));
  show('landing-account', !canSetUp);
  show('account-panel', signedIn || !guestMode);
  show('room-setup', canSetUp);
  show('guest-status', guestMode && !signedIn);
  $('landing').classList.toggle('login-landing', !canSetUp);
}
function render() {
  show('account-panel', !roomId);
  show('landing', !roomId && !accountRoute);
  show('account-page', !roomId && accountRoute);
  show('room', Boolean(roomId));
  renderAccountAppearance();
  renderLanding();
  if (!room) return;
  $('room-code').textContent = room.id;
  $('room-heading').textContent = room.status === 'waiting' ? t('room.waiting') : room.status === 'finished' ? t('room.complete') : room.status === 'paused' ? t('room.paused') : currentIsYou() ? t('room.yourMove') : t('room.theirMove', { name: room.players[room.current]?.name });
  $('room-subtitle').textContent = `${t('room.perTurn', { timer: formatTimer(room.timerSeconds) })} · ${room.mode === 'ai' ? t('room.bot', { difficulty: t(`difficulty.${room.difficulty}`) }) : t('room.players', { n: room.players.length })}`;
  show('copy-link', room.mode !== 'ai');
  show('join-panel', room.status === 'waiting' && !room.players.some(p => p.isYou));
  show('waiting-panel', room.status === 'waiting' && room.players.some(p => p.isYou));
  show('invite-panel', room.status === 'waiting' && Boolean(room.invites));
  if (room.invites) {
    show('host-email-field', !room.hostHasEmail);
    $('invite-status').textContent = room.invites.length ? t('room.inviteSent', { emails: room.invites }) : '';
  }
  show('delete-room', room.status === 'waiting' && room.players.length === 1 && room.players[0].isYou);
  show('room-sign-in', room.timerSeconds >= 86400 && !room.players.some(p => p.isYou));
  $('join-button').disabled = (room.timerSeconds >= 86400 && !accountToken) || (Boolean(signedInEmail) && !savedProfile.name);
  renderPauseControls();
  show('game-panel', room.status !== 'waiting');
  if (room.status === 'waiting') return;
  if (reviewRoomId !== room.id) { reviewTurn = null; reviewRoomId = room.id; }
  document.querySelector('.side-panel').classList.toggle('hidden', room.status === 'finished');
  document.querySelector('.play-layout').classList.toggle('review-layout', room.status === 'finished');
  renderScores(); renderBoard(); renderHand(); renderStaged(); renderLastMove(); updateCountdown(); renderReview();
}
function selectReviewTurn(turn) {
  reviewTurn = turn;
  renderReview(); renderBoard();
}
function renderReview() {
  const parent = $('game-review');
  show('game-review', room.status === 'finished');
  if (room.status !== 'finished') return;
  parent.replaceChildren();
  const heading = element('div', 'review-heading');
  const title = element('div');
  title.append(element('p', 'eyebrow', t('review.eyebrow')));
  const h2 = element('h2', '', t('review.title')); h2.id = 'review-heading'; title.append(h2);
  const winner = room.players.find(player => player.id === room.winner);
  title.append(element('p', 'fine', room.finishReason === 'missed-turns' ? t('review.drawMissed') : winner ? t('review.winner', { name: winner.name, scores: room.players.map(p => p.score).join(' – ') }) : t('review.drawEqual')));
  const again = element('a', 'secondary', t('review.newGame')); again.href = basePath;
  heading.append(title, again); parent.append(heading);
  const review = room.review;
  if (!review?.complete) parent.append(element('p', 'review-notice', t('review.incomplete')));
  if (!review?.turns.length) {
    parent.append(element('p', 'fine', t('review.noHistory')));
    return;
  }
  parent.append(element('p', 'fine', t('review.notes')));
  const summaries = element('div', 'review-summaries');
  room.players.forEach((player, index) => {
    const stats = review.players.find(p => p.playerId === player.id);
    const panel = element('article', `review-player player-${index}`);
    panel.append(element('h3', '', player.name), element('strong', 'review-score', t('game.points', { n: player.score })));
    const metrics = element('dl', 'review-metrics');
    const metric = (label, value) => { const group = element('div'); group.append(element('dt', '', label), element('dd', '', value)); metrics.append(group); };
    metric(t('review.avgCards'), stats.averageCards === null ? '—' : stats.averageCards.toFixed(2));
    metric(t('review.avgPoints'), stats.averagePoints === null ? '—' : stats.averagePoints.toFixed(2));
    metric(t('review.cardsPlaced'), String(stats.cardsPlaced)); metric(t('review.turns'), String(stats.turns));
    panel.append(metrics);
    for (const [kind, points, turns] of [['highest', stats.highest, stats.highestTurns], ['lowest', stats.lowest, stats.lowestTurns]]) {
      const line = element('div', 'review-extreme');
      line.append(element('span', '', t(`review.${kind}`, { points: points === null ? '—' : t('game.points', { n: points }) })));
      for (const turn of turns) { const button = element('button', 'review-turn-link', `#${turn}`); button.type = 'button'; button.setAttribute('aria-label', t(`review.${kind}Turn`, { name: player.name, turn, points })); button.onclick = () => selectReviewTurn(turn); line.append(button); }
      panel.append(line);
    }
    summaries.append(panel);
  });
  parent.append(summaries);
  parent.append(element('h3', '', t('review.perTurn')));
  const legend = element('div', 'review-legend');
  room.players.forEach((p, i) => legend.append(element('span', `player-${i}`, p.name)));
  parent.append(legend);
  const chart = element('div', 'review-chart'); chart.setAttribute('aria-label', t('review.chartLabel'));
  const peak = Math.max(1, ...review.turns.map(t => t.points));
  for (const turn of review.turns) {
    const index = room.players.findIndex(p => p.id === turn.playerId);
    const bar = element('button', `review-bar player-${index}${reviewTurn === turn.turn ? ' active' : ''}`);
    const labels = { turn: turn.turn, name: turn.playerName, points: turn.points };
    bar.type = 'button'; bar.setAttribute('aria-label', t('review.barLabel', labels));
    bar.setAttribute('aria-pressed', String(reviewTurn === turn.turn));
    bar.title = t('review.barTitle', labels);
    bar.append(element('span', 'review-bar-value', String(turn.points)));
    const fill = element('span', 'review-bar-fill'); fill.style.height = `${Math.max(3, turn.points / peak * 110)}px`;
    bar.append(fill, element('small', '', String(turn.turn))); bar.onclick = () => selectReviewTurn(turn.turn); chart.append(bar);
  }
  parent.append(chart);
  const chosen = review.turns.find(t => t.turn === reviewTurn);
  const detail = element('div', 'review-selection'); detail.setAttribute('role', 'status');
  detail.append(element('p', '', chosen ? t('review.selected', { turn: chosen.turn, name: chosen.playerName, points: chosen.points, cards: chosen.cardsPlaced }) : t('review.selectPrompt')));
  if (chosen) {
    const cards = element('div', 'review-cards');
    for (const placement of chosen.placements) { const item = element('div'); item.append(cardElement(placement.card), element('small', '', `(${placement.spot})${placement.kind === 'swap' ? t('review.wildReplacement') : ''}`)); cards.append(item); }
    if (!chosen.placements.length) cards.append(element('span', 'fine', chosen.kind === 'timeout' ? t('review.timedOutNone') : t('review.passedNone')));
    detail.append(cards);
    const clear = element('button', 'secondary', t('review.clear')); clear.type = 'button'; clear.onclick = () => selectReviewTurn(null); detail.append(clear);
  }
  parent.append(detail);
  const log = element('details', 'review-log'); log.open = true;
  log.append(element('summary', '', t('review.log')));
  const scroll = element('div', 'review-table-scroll');
  const table = element('table'); const caption = element('caption', 'fine', t('review.caption')); table.append(caption);
  const thead = element('thead'); const header = element('tr');
  for (const label of ['colTurn', 'colPlayer', 'colAction', 'colPoints', 'colScore']) { const th = element('th', '', t(`review.${label}`)); th.scope = 'col'; header.append(th); }
  thead.append(header); table.append(thead);
  const body = element('tbody');
  for (const turn of review.turns) {
    const row = element('tr', reviewTurn === turn.turn ? 'selected-turn' : '');
    const number = element('td'); const button = element('button', 'review-turn-link', `#${turn.turn}`); button.type = 'button'; button.setAttribute('aria-label', t('review.reviewTurn', { turn: turn.turn })); button.onclick = () => selectReviewTurn(turn.turn); number.append(button);
    const action = element('td'); action.append(element('span', 'fine', turn.kind === 'timeout' ? t('review.timedOut') : turn.kind === 'pass' ? t('review.passed') : t('review.played')));
    const cards = element('div', 'review-log-cards');
    for (const p of turn.placements) { const item = element('span', 'review-log-card'); item.append(cardElement(p.card), element('small', '', `(${p.spot})${p.kind === 'swap' ? t('review.swap') : ''}`)); cards.append(item); }
    action.append(cards);
    row.append(number, element('td', '', turn.playerName), action, element('td', 'review-points', `+${turn.points}`), element('td', '', turn.scores.join(' – '))); body.append(row);
  }
  table.append(body); scroll.append(table); log.append(scroll); parent.append(log);
}
function avatarStyle(node, name, color) {
  node.textContent = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?';
  node.style.backgroundColor = color;
  const rgb = color.slice(1).match(/../g).map(value => parseInt(value, 16));
  node.style.color = (.299*rgb[0] + .587*rgb[1] + .114*rgb[2]) > 155 ? '#183125' : '#fff';
}
function renderProfilePreview() {
  avatarStyle($('profile-avatar'), $('profile-name').value, $('profile-color').value);
}
const tileColourInputs = () => [...document.querySelectorAll('[data-tile-colour]')];
function formTileColors() {
  const colors = Object.fromEntries(tileColourInputs().map(input => [input.dataset.tileColour, input.value.toLowerCase()]));
  // Store null for the standard palette so future palette tweaks still reach these players.
  return Object.entries(SquareI18n.defaultTileColors).every(([name, value]) => colors[name] === value) ? null : colors;
}
function fillProfileForm(profile) {
  $('profile-name').value = profile.name;
  $('profile-color').value = profile.color;
  $('profile-language').value = profile.language;
  const colors = { ...SquareI18n.defaultTileColors, ...(profile.tileColors || {}) };
  for (const input of tileColourInputs()) input.value = colors[input.dataset.tileColour];
  renderProfilePreview();
}
// Settings preview live while editing; Cancel or leaving the form restores the saved ones.
function applyAccountSettings(profile) {
  SquareI18n.applySettings({ language: profile.language, tileColors: profile.tileColors });
}
function setEditingAccount(open) {
  editingAccount = open && Boolean(signedInEmail);
  show('profile-form', editingAccount);
  show('account-edit', !editingAccount);
  $('account-edit').setAttribute('aria-expanded', String(editingAccount));
  if (!editingAccount) { fillProfileForm(savedProfile); applyAccountSettings(savedProfile); }
}
function renderAccountAppearance() {
  show('header-account', true);
  const signedIn = Boolean(signedInEmail);
  show('account-default-icon', !signedIn);
  show('account-initial', signedIn);
  $('header-account').classList.toggle('has-profile', signedIn);
  if (signedIn) {
    avatarStyle($('account-initial'), savedProfile.name, savedProfile.color);
    $('header-account').setAttribute('aria-label', savedProfile.name ? t('account.named', { name: savedProfile.name }) : t('account.setUp'));
  } else $('header-account').setAttribute('aria-label', t('account.label'));
  show('create-name-field', !signedIn); show('join-name-field', !signedIn);
  show('profile-required', signedIn && !savedProfile.name);
  $('create-button').disabled = busy || (signedIn && !savedProfile.name);
  if (room) $('join-button').disabled = busy || (room.timerSeconds >= 86400 && !accountToken) || (signedIn && !savedProfile.name);
}
function useAccount(email, profile) {
  if (signedInEmail !== email) savedProfile = blankProfile();
  signedInEmail = email;
  if (profile) {
    savedProfile = { ...blankProfile(), ...profile };
    SquareI18n.rememberSettings(savedProfile);
    if (!editingAccount) { fillProfileForm(savedProfile); applyAccountSettings(savedProfile); }
    // A new account has to choose a name before playing, so open the form for it.
    if (accountRoute && !savedProfile.name && !editingAccount) setEditingAccount(true);
  }
  for (const id of ['host-email']) {
    $(id).value = email;
    $(id).readOnly = true;
  }
  renderAccountAppearance();
}
function renderAccountData() {
  const data = accountData;
  if (!data) return;
  $('account-identity').textContent = data.email;
  $('account-win-percent').textContent = `${data.winPercent}%`;
  $('account-games-played').textContent = String(data.gamesPlayed);
  $('account-current-count').textContent = String(data.currentGames.length);
  const list = $('account-current-games'); list.replaceChildren();
  if (!data.currentGames.length) list.append(element('p', 'fine', t('history.noCurrent')));
  for (const game of data.currentGames) {
    const link = element('a'); link.href = `${basePath}/room/${game.id}`;
    link.append(element('span', '', t('history.room', { id: game.id, opponent: game.opponent })),
      element('small', '', game.status === 'waiting' ? t('history.waiting') : game.status === 'paused' ? t('history.paused') : game.yourTurn ? t('history.yourTurn') : t('history.theirTurn')));
    list.append(link);
  }
  const finished = $('account-finished-games'); finished.replaceChildren();
  if (!data.finishedGames?.length) finished.append(element('p', 'fine', t('history.noCompleted')));
  for (const game of data.finishedGames || []) {
    const link = element('a'); link.href = `${basePath}/room/${game.id}`;
    const result = t(game.outcome === 'win' ? 'history.won' : game.outcome === 'loss' ? 'history.lost' : 'history.tied');
    const reason = game.finishReason === 'missed-turns' ? t('history.missedTurns') : '';
    const date = game.finishedAt ? new Date(game.finishedAt).toLocaleDateString(SquareI18n.locale()) : '';
    link.append(element('span', '', t('history.room', { id: game.id, opponent: game.opponent })),
      element('small', '', `${result} ${game.yourScore}–${game.opponentScore}${reason}${date ? ` · ${date}` : ''}`));
    finished.append(link);
  }
}
// Language and tile colours belong to the account, so signing out restores the defaults.
function resetAccountSettings() {
  savedProfile = blankProfile();
  accountData = null;
  editingAccount = false;
  show('profile-form', false); show('account-edit', true);
  SquareI18n.rememberSettings(null);
  fillProfileForm(savedProfile);
  applyAccountSettings(savedProfile);
}
// index.html marks a remembered session before first paint so the email form never flashes.
function doneRestoringAccount() { document.documentElement.classList.remove('account-restoring'); }
async function refreshAccount() {
  if (!accountToken) {
    doneRestoringAccount();
    show('account-sign-in', true); show('account-profile', false);
    show('account-history', false);
    renderLanding();
    return;
  }
  const requestedToken = accountToken;
  try {
    const data = await api('/api/account/me');
    // A response that finishes after sign-out must not restore the old session.
    if (accountToken !== requestedToken || localStorage.getItem('square-account-token') !== requestedToken) return;
    if (data.token) {
      accountToken = data.token;
      localStorage.setItem('square-account-token', accountToken);
    }
    useAccount(data.email, data.profile);
    show('account-sign-in', false); show('account-profile', true);
    show('account-history', true);
    accountData = data;
    renderAccountData();
  } catch (error) {
    if (accountToken !== requestedToken || localStorage.getItem('square-account-token') !== requestedToken) return;
    if (error.status === 401) {
      localStorage.removeItem('square-account-token'); accountToken = null; signedInEmail = null;
      resetAccountSettings();
      show('account-sign-in', true); show('account-profile', false);
      show('account-history', false);
      $('account-error').textContent = t('signin.expired');
    } else $('account-error').textContent = error.message;
  } finally {
    doneRestoringAccount();
  }
  renderLanding();
}
for (const id of ['profile-name', 'profile-color']) $(id).addEventListener('input', renderProfilePreview);
function previewFormSettings() {
  SquareI18n.applySettings({ language: $('profile-language').value, tileColors: formTileColors() });
}
$('profile-language').addEventListener('change', previewFormSettings);
for (const input of tileColourInputs()) input.addEventListener('input', previewFormSettings);
function setFormTileColors(colors) {
  for (const input of tileColourInputs()) input.value = colors[input.dataset.tileColour];
  previewFormSettings();
}
$('tile-colours-colourblind').addEventListener('click', () => setFormTileColors(SquareI18n.colourblindTileColors));
$('tile-colours-reset').addEventListener('click', () => setFormTileColors(SquareI18n.defaultTileColors));
$('account-edit').addEventListener('click', () => {
  setError('profile-error'); $('profile-message').textContent = '';
  setEditingAccount(true);
  $('profile-name').focus();
});
$('profile-cancel').addEventListener('click', () => {
  setError('profile-error'); $('profile-message').textContent = '';
  setEditingAccount(false);
  $('account-edit').focus();
});
$('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const requestedToken = accountToken;
  $('profile-save').disabled = true;
  setError('profile-error'); $('profile-message').textContent = '';
  try {
    const result = await api('/api/account/profile', { method: 'POST', body: JSON.stringify({ name: $('profile-name').value, color: $('profile-color').value, language: $('profile-language').value, tileColors: formTileColors() }) });
    if (accountToken !== requestedToken || localStorage.getItem('square-account-token') !== requestedToken) return;
    editingAccount = false;
    useAccount(result.email, result.profile);
    setEditingAccount(false);
    $('profile-message').textContent = t('profile.saved');
    $('account-edit').focus();
  } catch (error) { setError('profile-error', error.message); }
  finally { $('profile-save').disabled = false; }
});
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
    pill.append(element('small', '', `${player.name}${player.isYou ? ` · ${t('game.you')}` : ''} · ${t('game.cards', { n: player.cardCount })}`), element('strong', '', t('game.points', { n: player.score })));
    parent.append(pill);
  });
  $('turn-label').textContent = room.status === 'finished' ? t('game.finalScore') : t('game.timeLeft');
  $('deck-count').textContent = t('game.deck', { n: room.deckCount });
}
function renderLastMove() {
  show('last-move', Boolean(room.lastMove));
  if (room.lastMove) $('last-move').textContent = t('game.lastMove', { name: room.lastMove.playerName, kind: room.lastMove.kind, points: room.lastMove.points, lots: room.lastMove.lots });
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
  const reviewed = room.status === 'finished' ? room.review?.turns.find(turn => turn.turn === reviewTurn) : null;
  const reviewSpots = new Set(reviewed?.placements.map(p => p.spot) ?? []);
  const fragment = document.createDocumentFragment();
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const key = `${x},${y}`;
    const existing = room.board[key];
    const preview = staged.find(p => p.x === x && p.y === y);
    const cell = element('button', `cell ${existing || preview ? 'occupied' : 'empty'}`);
    cell.type = 'button';
    cell.setAttribute('aria-label', existing ? t('game.boardCard', { card: describeCard(existing), x, y }) : t('game.emptyCell', { x, y }));
    if (existing) cell.append(cardElement(existing, false, false, recent.has(key)));
    else if (preview) {
      const tile = cardElement(preview.card, false, true);
      if (previewStatus.status === 'legal' || previewStatus.status === 'illegal') tile.classList.add(previewStatus.status);
      cell.append(tile);
    }
    if (existing && room.status === 'finished') {
      const owner = room.review?.turns.findLast(turn => turn.placements.some(p => p.spot === key && p.card.id === existing.id));
      const attribution = owner ? t('game.placedBy', { name: owner.playerName, turn: owner.turn }) : key === '0,0' && room.review?.complete ? t('game.openingCard') : t('game.noHistory');
      cell.title = attribution;
      cell.setAttribute('aria-label', `${cell.getAttribute('aria-label')}. ${attribution}`);
      cell.classList.toggle('review-highlight', reviewSpots.has(key));
      cell.addEventListener('click', () => { if (owner) selectReviewTurn(owner.turn); });
    } else cell.addEventListener('click', () => boardClick(x, y, existing));
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
  $('hand-help').textContent = canAct ? ($('trade-mode').checked ? t('game.tradeHelp') : t('game.handHelp')) : t('game.handWaiting');
  renderControls();
}
function renderStaged(check = true) {
  $('staged').textContent = staged.length ? t('game.staged', { n: staged.length, spots: staged.map(p => `(${p.x}, ${p.y})`).join(', ') }) : room.pendingSwap ? t('game.pendingSwap', { base: room.pendingSwap.base, lots: room.pendingSwap.lots }) : t('game.noneStaged');
  if (check) updatePreview();
}
// Messages are built at display time so a language change also updates the preview.
function previewMessage() {
  const { status } = previewStatus;
  if (status === 'legal') return t('preview.legal', previewStatus);
  if (status === 'illegal') return t('preview.illegal', { reason: SquareI18n.serverMessage(previewStatus.reason) });
  if (status === 'unavailable') return t('preview.failed', previewStatus);
  return t(status === 'checking' ? 'preview.checking' : 'preview.empty');
}
function showPreview() {
  const node = $('move-preview');
  node.className = `move-preview ${previewStatus.status}`;
  node.textContent = previewMessage();
  renderControls();
}
async function updatePreview() {
  const revision = ++previewRevision;
  if (!staged.length) {
    previewStatus = { status: 'empty' };
    showPreview();
    renderBoard();
    return;
  }
  previewStatus = { status: 'checking' };
  showPreview();
  renderBoard();
  try {
    const result = await api(`/api/rooms/${roomId}/preview`, {
      method: 'POST', body: JSON.stringify({ placements: staged.map(({ card, ...place }) => place) })
    });
    if (revision !== previewRevision) return;
    if (result.legal) {
      const currentScore = room.players.find(player => player.isYou)?.score ?? 0;
      previewStatus = { status: 'legal', points: result.points, total: currentScore + result.points };
    } else previewStatus = { status: 'illegal', reason: result.reason };
  } catch (error) {
    if (revision !== previewRevision) return;
    previewStatus = { status: 'unavailable', message: error.message };
  }
  showPreview();
  renderBoard();
}
function renderControls() {
  renderAccountAppearance();
  if (room) renderPauseControls();
  const canAct = room?.status === 'playing' && currentIsYou() && !busy;
  $('play-button').disabled = !canAct || previewStatus.status !== 'legal';
  $('pass-button').disabled = !canAct;
  $('undo-button').disabled = !canAct || staged.length === 0;
  $('pass-button').textContent = $('trade-mode').checked && tradeIds.size ? t('game.tradePass', { n: tradeIds.size }) : t('game.pass');
}
function boardClick(x, y, existing) {
  if (!room || room.status !== 'playing' || !currentIsYou() || busy || !selected || $('trade-mode').checked) return;
  const card = room.hand.find(item => item.id === selected);
  if (!card) return;
  if (existing?.wild && !staged.length && !card.wild) {
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
    ? accepted ? t('pause.waitingResume') : t('pause.bothAgree')
    : requested ? mine ? t('pause.mine') : t('pause.theirs') : '';
  if (room.mode === 'ai' && room.status === 'paused') $('pause-status').textContent = t('pause.botPaused');
  $('pause-button').textContent = t(room.status === 'paused' ? room.mode === 'ai' ? 'pause.resumeBot' : 'pause.agreeResume' : requested ? mine ? 'pause.requested' : 'pause.accept' : room.mode === 'ai' ? 'pause.pauseBot' : 'pause.request');
  $('pause-button').disabled = busy || (room.status === 'paused' ? accepted : requested && mine);
  show('cancel-pause', room.status === 'playing' && requested);
  $('cancel-pause').textContent = mine ? t('pause.cancel') : t('pause.decline');
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
  if (room.mode === 'ai' && ['play', 'pass'].includes(input.type)) $('room-heading').textContent = t('room.botThinking');
  try {
    const data = await api(`/api/rooms/${roomId}/action`, { method: 'POST', body: JSON.stringify(input) });
    if (input.type !== 'swap') { staged = []; tradeIds.clear(); $('trade-mode').checked = false; }
    selected = null;
    setRoom(data);
    if (data.notificationSent === false && room.timerSeconds >= 86400 && room.status === 'playing') setError('room-error', t('room.emailFailed'));
  } catch (error) {
    setError('room-error', error.message);
    await refresh();
  } finally { busy = false; render(); }
}
function updateCountdown() {
  if (!room || room.status === 'waiting') return;
  if (room.status === 'finished') { $('countdown').textContent = room.finishReason === 'missed-turns' ? t('result.missedTurns') : room.winner ? t('result.wins', { name: room.players.find(p => p.id === room.winner)?.name }) : t('result.tie'); return; }
  if (room.status === 'paused') { $('countdown').textContent = t('result.paused'); return; }
  const left = Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000));
  const days = Math.floor(left / 86400), hours = Math.floor((left % 86400) / 3600), minutes = Math.floor((left % 3600) / 60), seconds = left % 60;
  $('countdown').textContent = days ? t('time.dh', { d: days, h: hours }) : hours ? t('time.hm', { h: hours, m: minutes }) : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
async function refresh() {
  if (!roomId || busy || room?.status === 'finished') return;
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
$('wildcard-slider').addEventListener('input', event => {
  $('wildcard-count').value = event.currentTarget.value;
});
function renderBotSetup() {
  const bot = gameMode === 'ai';
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === gameMode)));
  show('bot-options', bot);
  document.querySelector('.day-buttons').classList.toggle('hidden', bot);
  if (bot && timerSeconds >= 86400) {
    timerSeconds = Number($('timer-slider').value) * 60;
    $('minute-label').textContent = formatTimer(timerSeconds);
    document.querySelectorAll('[data-days]').forEach(button => button.classList.remove('active'));
  }
  $('timer-help').textContent = bot ? t('setup.botTimerHelp') : t('setup.timerHelp');
  $('create-button').textContent = bot ? t('setup.playBot') : t('setup.createRoom');
  $('minute-label').textContent = formatTimer(timerSeconds);
  document.querySelectorAll('[data-days]').forEach(button => { button.textContent = formatTimer(Number(button.dataset.days) * 86400); });
}
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  gameMode = button.dataset.mode;
  renderBotSetup();
}));
$('bot-difficulty').addEventListener('change', renderBotSetup);
renderBotSetup();
$('create-button').addEventListener('click', async () => {
  if (busy) return;
  busy = true; $('create-button').disabled = true;
  setError('setup-error');
  try {
    const data = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: $('create-name').value, timerSeconds, wildcardCount: Number($('wildcard-slider').value), mode: gameMode, difficulty: $('bot-difficulty').value }) });
    if (!signedInEmail) localStorage.setItem('square-player-name', $('create-name').value.trim());
    setRoom(data, data.token);
  } catch (error) { setError('setup-error', error.message); }
  finally { busy = false; $('create-button').disabled = false; renderControls(); }
});
$('join-button').addEventListener('click', async () => {
  setError('room-error');
  try {
    const data = await api(`/api/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ name: $('join-name').value }) });
    if (!signedInEmail) localStorage.setItem('square-player-name', $('join-name').value.trim());
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
  if (!/^\d{4}$/.test(code)) return setError('join-code-error', t('setup.codeError'));
  playerToken = localStorage.getItem(`square-token-${code}`);
  try { setRoom(await api(`/api/rooms/${code}`)); }
  catch (error) { playerToken = null; setError('join-code-error', error.message); }
}
$('join-code-button').addEventListener('click', joinByCode);
$('join-code-input').addEventListener('keydown', event => { if (event.key === 'Enter') joinByCode(); });
$('copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`${location.origin}${basePath}/room/${roomId}`); $('copy-status').textContent = t('room.copied'); }
  catch { $('copy-status').textContent = t('room.copyFailed'); }
});
$('play-button').addEventListener('click', () => act({ type: 'play', placements: staged.map(({ card, ...place }) => place) }));
$('undo-button').addEventListener('click', () => { staged.pop(); renderBoard(); renderHand(); renderStaged(); });
$('pass-button').addEventListener('click', () => act({ type: 'pass', tradeIds: $('trade-mode').checked ? [...tradeIds] : [] }));
$('trade-mode').addEventListener('change', () => { selected = null; tradeIds.clear(); renderHand(); });

$('code-request-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  setError('account-error'); $('account-message').textContent = t('signin.sending');
  try {
    await api('/api/account/request-code', { method: 'POST', body: JSON.stringify({ email: $('account-email').value }) });
    show('code-verify-form', true);
    $('account-code').focus();
    $('account-message').textContent = t('signin.checkEmail');
  } catch (error) { $('account-message').textContent = ''; setError('account-error', error.message); }
  finally { button.disabled = false; }
});
$('play-as-guest').addEventListener('click', () => {
  const button = $('play-as-guest');
  button.disabled = true;
  guestMode = true;
  sessionStorage.setItem('square-guest-mode', 'true');
  if (accountRoute) {
    sessionStorage.setItem('square-guest-tutorial-pending', 'true');
    location.href = basePath;
    return;
  }
  renderLanding();
  shuffleHeroCards()?.catch(console.error);
  $('create-name').focus({ preventScroll: true });
  button.disabled = false;
  $('open-tutorial').click();
});
$('guest-sign-in').addEventListener('click', () => {
  guestMode = false;
  sessionStorage.removeItem('square-guest-mode');
  renderLanding();
  $('account-email').focus();
});
$('code-verify-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  setError('account-error');
  try {
    const result = await api('/api/account/verify-code', { method: 'POST', body: JSON.stringify({ email: $('account-email').value, code: $('account-code').value }) });
    accountToken = result.token;
    useAccount(result.email);
    guestMode = false;
    sessionStorage.removeItem('square-guest-mode');
    localStorage.setItem('square-account-token', accountToken);
    $('account-code').value = '';
    show('code-verify-form', false);
    $('account-message').textContent = '';
    show('account-sign-in', false);
    renderLanding();
    shuffleHeroCards()?.catch(console.error);
    if (!roomId && !accountRoute) $('header-account').focus({ preventScroll: true });
    await linkSavedRooms();
    await refreshAccount();
    if (roomId) await refresh();
    else if (!accountRoute) $('header-account').focus({ preventScroll: true });
  } catch (error) { setError('account-error', error.message); }
  finally { button.disabled = false; }
});
$('account-sign-out').addEventListener('click', () => {
  const email = signedInEmail;
  localStorage.removeItem('square-account-token'); accountToken = null; signedInEmail = null;
  resetAccountSettings();
  $('profile-message').textContent = '';
  guestMode = false;
  sessionStorage.removeItem('square-guest-mode');
  for (const id of ['host-email']) {
    $(id).readOnly = false;
    if ($(id).value === email) $(id).value = '';
  }
  show('account-sign-in', true); show('account-profile', false);
  show('account-history', false);
  setError('account-error');
  renderLanding();
});

const mobileRoomLayout = window.matchMedia('(max-width: 530px)');
function positionPauseControls() {
  const destination = document.querySelector(mobileRoomLayout.matches ? '.room-actions' : '.score-controls');
  destination.append($('pause-controls'));
}
mobileRoomLayout.addEventListener('change', positionPauseControls);
positionPauseControls();

// Redraw everything built in script when the account language changes.
SquareI18n.onChange(() => {
  renderBotSetup();
  renderAccountData();
  render();
  if (roomId) updateCountdown();
});

async function start() {
  let signInError;
  if (roomId) {
    const signInLink = new URLSearchParams(location.hash.slice(1)).get('signin');
    const queryToken = new URLSearchParams(location.search).get('token');
    playerToken = queryToken || localStorage.getItem(`square-token-${roomId}`);
    // Remove credentials before fetching or polling the room.
    if (queryToken || signInLink) history.replaceState(null, '', `${basePath}/room/${roomId}`);
    if (queryToken) localStorage.setItem(`square-token-${roomId}`, queryToken);
    if (signInLink) {
      try {
        const result = await api('/api/account/turn-link', { method: 'POST', body: JSON.stringify({ token: signInLink, roomId }) });
        accountToken = result.token;
        signedInEmail = result.email;
        playerToken = result.playerToken;
        localStorage.setItem('square-account-token', accountToken);
        localStorage.setItem(`square-token-${roomId}`, playerToken);
      } catch (error) { signInError = error.message; }
    }
    await refresh();
  }
  if (accountToken && roomId && playerToken) await linkSavedRooms();
  await refreshAccount();
  if (signInError) {
    setError('room-error', signInError);
    // Keep recovery available even if this browser had another account signed in.
    const recovery = element('a', '', t('signin.withCode'));
    recovery.href = `${basePath}/account`;
    $('room-error').append(recovery);
  }
  setInterval(updateCountdown, 1000);
  if (!signInError) setInterval(refresh, 10000);
}
start();
