import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, joinGame, newDeck, playCards, swapWild, passTurn, advanceExpired, validateBoard, timerValid, inviteFriend, publicGame } from '../game.js';

const c = (id, color, shape, number) => ({ id, color, shape, number });

test('deck contains 64 unique regular cards and two wild cards', () => {
  const deck = newDeck();
  assert.equal(deck.length, 66);
  assert.equal(deck.filter(card => card.wild).length, 2);
  assert.equal(new Set(deck.filter(card => !card.wild).map(card => `${card.color}-${card.shape}-${card.number}`)).size, 64);
});

test('timer options and two-player room setup', () => {
  assert.equal(timerValid(60), true);
  assert.equal(timerValid(600), true);
  assert.equal(timerValid(86400), true);
  assert.equal(timerValid(601), false);
  const waiting = createGame({ name: 'A', timerSeconds: 60, now: 1000 });
  const game = joinGame(waiting, { name: 'B', now: 2000 });
  assert.equal(game.players.length, 2);
  assert.equal(game.players[0].hand.length, 4);
  assert.equal(game.players[1].hand.length, 4);
  assert.equal(game.deadline, 62000);
});

test('two consecutive missed turns by one player end the game in a tie', () => {
  const game = joinGame(createGame({ name: 'A', timerSeconds: 60, now: 1000 }), { name: 'B', now: 2000 });
  const first = game.current;
  game.players[0].score = 30;
  game.players[1].score = 5;
  const afterOneMiss = advanceExpired(game, 62000);
  assert.equal(afterOneMiss.status, 'playing');
  // The other player keeps playing; the first player misses again.
  const played = passTurn(afterOneMiss, 1 - first, [], 62001);
  const finished = advanceExpired(played, 122001);
  assert.equal(finished.status, 'finished');
  assert.equal(finished.missedTurns[first], 2);
  assert.equal(finished.missedTurns[1 - first], 0);
  assert.equal(finished.winner, null);
  assert.equal(finished.finishReason, 'missed-turns');
  assert.equal(finished.finishedAt, 122001);
  assert.equal(finished.deadline, null);
});

test('taking a turn resets that player’s consecutive missed turns', () => {
  const game = joinGame(createGame({ name: 'A', timerSeconds: 60, now: 1000 }), { name: 'B', now: 2000 });
  const first = game.current;
  let state = advanceExpired(game, 62000);
  state = passTurn(state, 1 - first, [], 62001);
  state = passTurn(state, first, [], 62002);
  assert.equal(state.missedTurns[first], 0);
  state = advanceExpired(state, 122002);
  state = advanceExpired(state, 182002);
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.missedTurns, [1, 1]);
});

test('only the host can invite, and needs an email to hear back', () => {
  const waiting = createGame({ name: 'A', timerSeconds: 60, now: 1000 });
  assert.throws(() => inviteFriend(waiting, 0, { email: 'b@example.com' }), /your email/);
  assert.throws(() => inviteFriend(waiting, 1, { email: 'b@example.com', yourEmail: 'a@example.com' }), /host/);
  assert.throws(() => inviteFriend(waiting, 0, { email: 'a@example.com', yourEmail: 'a@example.com' }), /not your own/);
  let invited = inviteFriend(waiting, 0, { email: 'B@Example.com', yourEmail: 'a@example.com' });
  assert.equal(invited.players[0].email, 'a@example.com');
  assert.deepEqual(publicGame(invited, 0).invites, ['b@example.com']);
  assert.equal(publicGame(invited, -1).invites, undefined);
  invited = inviteFriend(invited, 0, { email: 'c@example.com' });
  invited = inviteFriend(invited, 0, { email: 'd@example.com' });
  assert.throws(() => inviteFriend(invited, 0, { email: 'e@example.com' }), /up to 3/);
  const joined = joinGame(invited, { name: 'B', now: 2000 });
  assert.throws(() => inviteFriend(joined, 0, { email: 'e@example.com' }), /already full/);
});

test('three-card lines require each property to be all same or all different', () => {
  assert.doesNotThrow(() => validateBoard({
    '0,0': c('a', 'red', 'circle', 1), '1,0': c('b', 'blue', 'square', 2), '2,0': c('c', 'green', 'triangle', 3)
  }));
  assert.throws(() => validateBoard({
    '0,0': c('a', 'red', 'circle', 1), '1,0': c('b', 'blue', 'square', 2), '2,0': c('c', 'red', 'triangle', 3)
  }), /invalid line/);
});

test('a wild can be reinterpreted on a later move but is one card across crossing lines', () => {
  const game = {
    status: 'playing', current: 0,
    board: { '0,0': { id: 'wild', wild: true, as: { color: 'red', shape: 'circle', number: 1 } }, '1,0': c('blue', 'blue', 'square', 2) },
    deck: [], players: [{ id: 'p1', hand: [c('new', 'red', 'triangle', 3), c('extra', 'yellow', 'star', 4)], score: 0 }, { id: 'p2', hand: [], score: 0 }],
    pendingSwap: null, consecutivePasses: 0, timerSeconds: 60, deadline: 10000
  };
  const played = playCards(game, 0, [{ x: 2, y: 0, cardId: 'new' }], 100);
  assert.notEqual(played.board['0,0'].as.color, 'red');
  assert.equal(played.lastMove.points, 5);
  const conflict = {
    '0,0': { id: 'crossing', wild: true },
    '1,0': c('h1', 'red', 'circle', 1), '2,0': c('h2', 'red', 'circle', 1),
    '0,1': c('v1', 'blue', 'square', 2), '0,2': c('v2', 'blue', 'square', 2)
  };
  assert.throws(() => validateBoard(conflict), /invalid line/);
});

test('wild exchange scores two existing lots and a subsequent lot stacks a third double', () => {
  const wild = { id: 'wild', wild: true, as: { color: 'yellow', shape: 'star', number: 4 } };
  const board = {
    '-3,0': c('h1', 'red', 'circle', 1), '-2,0': c('h2', 'blue', 'square', 2), '-1,0': c('h3', 'green', 'triangle', 3), '0,0': wild,
    '0,-3': c('v1', 'red', 'circle', 1), '0,-2': c('v2', 'blue', 'square', 2), '0,-1': c('v3', 'green', 'triangle', 3),
    '-5,1': c('b1', 'green', 'triangle', 3), '-4,1': c('b2', 'yellow', 'star', 4), '-3,1': c('b3', 'blue', 'square', 2)
  };
  validateBoard(board);
  const game = {
    status: 'playing', current: 0, board, deck: [], players: [
      { id: 'p1', hand: [c('replace', 'yellow', 'star', 4), c('finish', 'red', 'circle', 1), c('extra', 'red', 'star', 3)], score: 0 },
      { id: 'p2', hand: [c('other', 'blue', 'circle', 4)], score: 0 }
    ], pendingSwap: null, consecutivePasses: 0, timerSeconds: 60, deadline: 100000, lastMove: null
  };
  const swapped = swapWild(game, 0, { x: 0, y: 0, cardId: 'replace' });
  assert.deepEqual(swapped.pendingSwap, { base: 20, lots: 2, at: swapped.pendingSwap.at, spot: '0,0' });
  assert.equal(swapped.players[0].hand.some(card => card.id === 'wild'), true);
  const played = playCards(swapped, 0, [{ x: -6, y: 1, cardId: 'finish' }], 5000);
  assert.equal(played.lastMove.base, 30);
  assert.equal(played.lastMove.lots, 3);
  assert.equal(played.lastMove.points, 240);
  assert.deepEqual(played.lastMove.cells, ['0,0', '-6,1']);
  assert.equal(played.players[0].score, 240);
});

test('play must be connected and in one line', () => {
  const game = {
    status: 'playing', current: 0, board: { '0,0': c('starter', 'red', 'circle', 1) }, deck: [],
    players: [{ id: 'p1', hand: [c('a', 'blue', 'square', 2), c('b', 'green', 'triangle', 3)], score: 0 }, { id: 'p2', hand: [], score: 0 }],
    pendingSwap: null, consecutivePasses: 0, timerSeconds: 60, deadline: 10000
  };
  assert.throws(() => playCards(game, 0, [{ x: 5, y: 5, cardId: 'a' }]), /connect/);
  assert.throws(() => playCards(game, 0, [{ x: 1, y: 0, cardId: 'a' }, { x: 0, y: 1, cardId: 'b' }]), /one row or column/);
  const played = playCards(game, 0, [{ x: 1, y: 0, cardId: 'a' }], 10);
  assert.equal(played.lastMove.points, 3);
  assert.deepEqual(played.lastMove.cells, ['1,0']);
});

test('passing can trade a selected card', () => {
  const game = {
    status: 'playing', current: 0, board: { '0,0': c('starter', 'red', 'circle', 1) }, deck: [c('draw', 'green', 'star', 4)],
    players: [{ id: 'p1', hand: [c('trade', 'blue', 'square', 2)], score: 0 }, { id: 'p2', hand: [], score: 0 }],
    pendingSwap: null, consecutivePasses: 0, timerSeconds: 60, deadline: 10000
  };
  const next = passTurn(game, 0, ['trade'], 100);
  assert.equal(next.players[0].hand.some(card => card.id === 'draw'), true);
  assert.equal(next.deck[0].id, 'trade');
});

test('fabricated cards, illegal coordinates, and wrong-turn moves cannot alter a game', () => {
  const game = {
    status: 'playing', current: 0, board: { '0,0': c('starter', 'red', 'circle', 1) }, deck: [],
    players: [
      { id: 'p1', hand: [c('own', 'blue', 'square', 2)], score: 0 },
      { id: 'p2', hand: [c('opponent', 'green', 'triangle', 3)], score: 0 }
    ],
    pendingSwap: null, consecutivePasses: 0, timerSeconds: 60, deadline: 10000
  };
  assert.throws(() => playCards(game, 0, [{ x: 1, y: 0, cardId: 'opponent' }]), /not in your hand/);
  assert.throws(() => playCards(game, 1, [{ x: 1, y: 0, cardId: 'opponent' }]), /not your turn/);
  assert.throws(() => playCards(game, 0, [{ x: 1.5, y: 0, cardId: 'own' }]), /Invalid board position/);
  assert.throws(() => playCards(game, 0, [{ x: 1, y: 0, cardId: 'own' }, { x: 1, y: 0, cardId: 'own' }]), /unique space/);
  assert.equal(game.players[0].score, 0);
  assert.equal(game.board['1,0'], undefined);
  assert.equal(game.players[0].hand[0].id, 'own');
});

test('wild exchange is limited to a legal regular card before the main move', () => {
  const game = {
    status: 'playing', current: 0,
    board: { '0,0': { id: 'wild', wild: true, as: { color: 'red', shape: 'circle', number: 1 } }, '1,0': c('other', 'blue', 'square', 2) },
    deck: [], players: [{ id: 'p1', hand: [c('regular', 'green', 'triangle', 3), { id: 'ownwild', wild: true }], score: 0 }, { id: 'p2', hand: [], score: 0 }],
    pendingSwap: null, consecutivePasses: 0, timerSeconds: 60, deadline: 10000
  };
  assert.throws(() => swapWild(game, 0, { x: 0, y: 0, cardId: 'ownwild' }), /regular card/);
  assert.throws(() => swapWild(game, 0, { x: 1, y: 0, cardId: 'regular' }), /no wild card/);
  const swapped = swapWild(game, 0, { x: 0, y: 0, cardId: 'regular' });
  assert.throws(() => swapWild(swapped, 0, { x: 0, y: 0, cardId: 'regular' }), /only one wild card/);
});
