import { randomBytes, randomInt } from 'node:crypto';

export const COLORS = ['red', 'blue', 'green', 'yellow'];
export const SHAPES = ['circle', 'square', 'triangle', 'star'];
export const TIMER_OPTIONS = [86400, 172800, 259200, 604800];

function fail(message) { throw new Error(message); }
function token(bytes = 18) { return randomBytes(bytes).toString('base64url'); }
export function roomCode() { return String(randomInt(10000)).padStart(4, '0'); }
function key(x, y) { return `${x},${y}`; }
function coord(value) {
  if (!Number.isInteger(value) || Math.abs(value) > 100) fail('Invalid board position.');
  return value;
}
function copy(value) { return structuredClone(value); }
function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function newDeck() {
  const cards = [];
  for (const color of COLORS) for (const shape of SHAPES) for (let number = 1; number <= 4; number++) {
    cards.push({ id: token(9), color, shape, number });
  }
  cards.push({ id: token(9), wild: true }, { id: token(9), wild: true });
  return shuffle(cards);
}
function draw(game, player) {
  while (player.hand.length < 4 && game.deck.length) player.hand.push(game.deck.pop());
}
export function timerValid(seconds) {
  return Number.isInteger(seconds) && ((seconds >= 60 && seconds <= 600 && seconds % 60 === 0) || TIMER_OPTIONS.includes(seconds));
}
export function isDayGame(game) { return game.timerSeconds >= 86400; }
export function createGame({ name, email, accountEmail, timerSeconds, now = Date.now() }) {
  if (!timerValid(timerSeconds)) fail('Choose a timer from 1–10 minutes or 1, 2, 3, or 7 days.');
  if (timerSeconds >= 86400 && !email) fail('Email is required for day-length games.');
  const deck = newDeck();
  const starter = deck.pop();
  // The printed game starts with one face-up card. Give a wild starter one fixed identity.
  if (starter.wild) starter.as = { color: COLORS[randomInt(4)], shape: SHAPES[randomInt(4)], number: randomInt(1, 5) };
  const game = {
    id: roomCode(), status: 'waiting', timerSeconds, createdAt: now,
    players: [{ id: token(9), token: token(), name: cleanName(name), email: cleanEmail(email), ...(accountEmail ? { accountEmail } : {}), hand: [], score: 0 }],
    board: { '0,0': starter }, deck, current: 0, deadline: null,
    consecutivePasses: 0, pendingSwap: null, lastMove: null, winner: null
  };
  draw(game, game.players[0]);
  return game;
}
function cleanName(name) {
  const value = String(name ?? '').trim().slice(0, 30);
  if (!value) fail('Enter a player name.');
  return value;
}
function cleanEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail('Enter a valid email address.');
  return value;
}
export function joinGame(source, { name, email, accountEmail, now = Date.now() }) {
  const game = copy(source);
  if (game.status !== 'waiting') fail('This room is already full.');
  if (isDayGame(game) && !email) fail('Email is required for day-length games.');
  if (accountEmail && game.players[0].accountEmail === accountEmail) fail('You cannot join your own room.');
  const player = { id: token(9), token: token(), name: cleanName(name), email: cleanEmail(email), ...(accountEmail ? { accountEmail } : {}), hand: [], score: 0 };
  game.players.push(player);
  draw(game, player);
  game.status = 'playing';
  game.current = randomInt(2);
  game.deadline = now + game.timerSeconds * 1000;
  return game;
}
export const MAX_INVITES = 3;
export function inviteFriend(source, index, { email, yourEmail, now = Date.now() }) {
  const game = copy(source);
  if (index !== 0) fail('Only the room host can send invites.');
  if (game.status !== 'waiting') fail('This room is already full.');
  const invites = game.invites ?? [];
  if (invites.length >= MAX_INVITES) fail(`You can send up to ${MAX_INVITES} invites per room.`);
  const host = game.players[0];
  const to = cleanEmail(email);
  if (!to) fail('Enter your friend\'s email address.');
  if (!host.email) host.email = cleanEmail(yourEmail);
  if (!host.email) fail('Enter your email so we can tell you when they accept.');
  if (to === host.email) fail('Enter your friend\'s email, not your own.');
  game.invites = [...invites, { email: to, at: now }];
  return game;
}
export function playerIndex(game, playerToken) {
  return game.players.findIndex(p => p.token === playerToken);
}
function requireTurn(game, index) {
  if (game.status !== 'playing') fail('This game is not active.');
  if (index !== game.current) fail('It is not your turn.');
}
function selectedCard(player, id) {
  const index = player.hand.findIndex(card => card.id === id);
  if (index < 0) fail('Card is not in your hand.');
  return [player.hand[index], index];
}
function normalizeCard(card) {
  if (!card.wild) return card;
  return { id: card.id, wild: true };
}
function property(card, field) { return card.wild ? card.as?.[field] : card[field]; }
function validLine(cards) {
  if (cards.length > 4) return false;
  if (cards.length < 3) return true;
  for (const field of ['color', 'shape', 'number']) {
    const values = cards.map(card => property(card, field));
    if (values.some(value => value === undefined)) return false;
    if (new Set(values).size !== 1 && new Set(values).size !== values.length) return false;
  }
  return true;
}
export function boardLines(board) {
  const cells = Object.entries(board).map(([spot, card]) => {
    const [x, y] = spot.split(',').map(Number);
    return { x, y, card, spot };
  });
  const lines = [];
  for (const axis of ['h', 'v']) {
    const groups = new Map();
    for (const cell of cells) {
      const fixed = axis === 'h' ? cell.y : cell.x;
      if (!groups.has(fixed)) groups.set(fixed, []);
      groups.get(fixed).push(cell);
    }
    for (const row of groups.values()) {
      row.sort((a, b) => axis === 'h' ? a.x - b.x : a.y - b.y);
      let run = [];
      for (const cell of row) {
        const previous = run.at(-1);
        if (previous && (axis === 'h' ? cell.x - previous.x : cell.y - previous.y) !== 1) {
          if (run.length > 1) lines.push({ axis, cells: run });
          run = [];
        }
        run.push(cell);
      }
      if (run.length > 1) lines.push({ axis, cells: run });
    }
  }
  return lines;
}
export function validateBoard(board) {
  const lines = boardLines(board);
  if (lines.some(line => line.cells.length > 4)) fail('That makes an invalid line or a line longer than four.');
  const wilds = Object.values(board).filter(card => card.wild);
  const choices = [];
  for (const color of COLORS) for (const shape of SHAPES) for (let number = 1; number <= 4; number++) choices.push({ color, shape, number });
  const original = wilds.map(card => card.as);
  const legal = () => lines.every(line => validLine(line.cells.map(cell => cell.card)));
  function assign(index) {
    if (index === wilds.length) return legal();
    const preferred = wilds[index].as;
    const candidates = preferred ? [preferred, ...choices.filter(choice => choice.color !== preferred.color || choice.shape !== preferred.shape || choice.number !== preferred.number)] : choices;
    for (const choice of candidates) {
      wilds[index].as = choice;
      if (assign(index + 1)) return true;
    }
    return false;
  }
  if (!assign(0)) {
    wilds.forEach((card, index) => { if (original[index]) card.as = original[index]; else delete card.as; });
    fail('That makes an invalid line or a line longer than four.');
  }
  return lines;
}
function scoreLines(lines, changed) {
  const affected = lines.filter(line => line.cells.some(cell => changed.has(cell.spot)));
  return {
    base: affected.reduce((sum, line) => sum + line.cells.reduce((n, cell) => n + (cell.card.wild ? 0 : cell.card.number), 0), 0),
    lots: affected.filter(line => line.cells.length === 4).length,
    lines: affected.length
  };
}
function finalize(game, index, { base, lots, count, kind, cells = [] }, now) {
  const player = game.players[index];
  const hadSwap = Boolean(game.pendingSwap);
  const pending = game.pendingSwap ?? { base: 0, lots: 0 };
  const combinedBase = pending.base + base;
  const combinedLots = pending.lots + lots;
  const allFour = count === 4;
  const emptied = game.deck.length === 0 && player.hand.length === 0;
  const points = combinedBase * (2 ** combinedLots) * (allFour ? 2 : 1) * (emptied ? 2 : 1);
  player.score += points;
  game.pendingSwap = null;
  game.consecutivePasses = kind === 'pass' && !hadSwap ? game.consecutivePasses + 1 : 0;
  game.lastMove = { playerId: player.id, playerName: player.name, kind, points, base: combinedBase, lots: combinedLots, at: now, cells: pending.spot ? [pending.spot, ...cells] : cells };
  if (emptied || (game.deck.length === 0 && game.consecutivePasses >= 2)) {
    game.status = 'finished';
    game.deadline = null;
    game.winner = game.players[0].score === game.players[1].score ? null : game.players.reduce((a, b) => a.score > b.score ? a : b).id;
  } else {
    game.current = 1 - index;
    game.deadline = now + game.timerSeconds * 1000;
  }
  return game;
}
export function playCards(source, index, placements, now = Date.now()) {
  const game = copy(source);
  requireTurn(game, index);
  if (!Array.isArray(placements) || placements.length < 1 || placements.length > 4) fail('Play between one and four cards.');
  const player = game.players[index];
  const spots = new Set();
  const ids = new Set();
  const positions = [];
  for (const place of placements) {
    const x = coord(place.x), y = coord(place.y), spot = key(x, y);
    if (game.board[spot] || spots.has(spot)) fail('Each card needs an empty, unique space.');
    if (ids.has(place.cardId)) fail('A card can only be played once.');
    const [card] = selectedCard(player, place.cardId);
    game.board[spot] = normalizeCard(card);
    spots.add(spot); ids.add(place.cardId); positions.push({ x, y });
  }
  if (new Set(positions.map(p => p.x)).size !== 1 && new Set(positions.map(p => p.y)).size !== 1) fail('Cards played together must be in one row or column.');
  if (positions.length > 1) {
    const horizontal = positions.every(p => p.y === positions[0].y);
    const values = positions.map(p => horizontal ? p.x : p.y);
    for (let value = Math.min(...values); value <= Math.max(...values); value++) {
      if (!game.board[horizontal ? key(value, positions[0].y) : key(positions[0].x, value)]) fail('A move cannot leave gaps between its played cards.');
    }
  }
  const connected = [...spots].some(spot => {
    const [x, y] = spot.split(',').map(Number);
    return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some(([a, b]) => source.board[key(a, b)]);
  });
  if (!connected) fail('Your move must connect to the board.');
  const lines = validateBoard(game.board);
  const score = scoreLines(lines, spots);
  player.hand = player.hand.filter(card => !ids.has(card.id));
  const ended = game.deck.length === 0 && player.hand.length === 0;
  if (!ended) draw(game, player);
  return finalize(game, index, { ...score, count: placements.length, kind: 'play', cells: [...spots] }, now);
}
export function swapWild(source, index, { x, y, cardId }, now = Date.now()) {
  const game = copy(source);
  requireTurn(game, index);
  if (game.pendingSwap) fail('You can exchange only one wild card before a turn.');
  const spot = key(coord(x), coord(y));
  const wild = game.board[spot];
  if (!wild?.wild) fail('There is no wild card in that space.');
  const player = game.players[index];
  const [replacement, handIndex] = selectedCard(player, cardId);
  if (replacement.wild) fail('Replace the wild card with a regular card.');
  game.board[spot] = replacement;
  const lines = validateBoard(game.board);
  const score = scoreLines(lines, new Set([spot]));
  player.hand[handIndex] = { id: wild.id, wild: true };
  game.pendingSwap = { base: score.base, lots: score.lots, at: now, spot };
  return game;
}
export function passTurn(source, index, tradeIds = [], now = Date.now()) {
  const game = copy(source);
  requireTurn(game, index);
  if (!Array.isArray(tradeIds) || new Set(tradeIds).size !== tradeIds.length) fail('Invalid trade.');
  const player = game.players[index];
  for (const id of tradeIds) if (!player.hand.some(card => card.id === id)) fail('Card is not in your hand.');
  if (tradeIds.length > game.deck.length) fail('Not enough cards remain to trade.');
  const traded = player.hand.filter(card => tradeIds.includes(card.id));
  player.hand = player.hand.filter(card => !tradeIds.includes(card.id));
  // Draw before placing traded cards at the bottom of the pile.
  draw(game, player);
  game.deck.unshift(...traded);
  return finalize(game, index, { base: 0, lots: 0, count: 0, kind: 'pass' }, now);
}
export function advanceExpired(source, now = Date.now()) {
  let game = copy(source);
  let count = 0;
  while (game.status === 'playing' && game.deadline <= now && count < 2) {
    const at = game.deadline;
    game = finalize(game, game.current, { base: 0, lots: 0, count: 0, kind: 'timeout' }, at);
    count++;
  }
  // For very long idle periods, give the current player a fresh full turn.
  if (game.status === 'playing' && game.deadline <= now) game.deadline = now + game.timerSeconds * 1000;
  return game;
}
export function publicGame(game, index) {
  return {
    id: game.id, status: game.status, timerSeconds: game.timerSeconds,
    players: game.players.map((p, i) => ({ id: p.id, name: p.name, score: p.score, cardCount: p.hand.length, isYou: i === index })),
    board: game.board, hand: index >= 0 ? game.players[index].hand : [], deckCount: game.deck.length,
    current: game.current, deadline: game.deadline, pendingSwap: index === game.current ? game.pendingSwap : null,
    lastMove: game.lastMove, winner: game.winner,
    // Only the host sees invite details; the joining player never sees emails.
    ...(index === 0 ? { invites: (game.invites ?? []).map(invite => invite.email), hostHasEmail: Boolean(game.players[0].email) } : {})
  };
}
export function accountSummary(games, email, now = Date.now()) {
  let gamesPlayed = 0;
  let wins = 0;
  const currentGames = [];
  for (const original of games) {
    const game = advanceExpired(original, now);
    const index = game.players.findIndex(player => player.accountEmail === email);
    if (index < 0) continue;
    if (game.status === 'finished') {
      gamesPlayed++;
      if (game.winner === game.players[index].id) wins++;
    } else {
      currentGames.push({
        id: game.id, status: game.status, yourTurn: game.status === 'playing' && game.current === index,
        opponent: game.players[1 - index]?.name ?? 'Waiting for a friend',
        createdAt: game.createdAt ?? 0
      });
    }
  }
  currentGames.sort((a, b) => b.createdAt - a.createdAt);
  return { gamesPlayed, wins, winPercent: gamesPlayed ? Math.round(100 * wins / gamesPlayed) : 0, currentGames };
}
