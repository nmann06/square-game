import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, joinGame, playCards, passTurn, swapWild, advanceExpired, publicGame, gameReview } from '../game.js';

const card = (id, number) => ({ id, color: 'red', shape: 'circle', number });
function fixture() {
  const game = joinGame(createGame({ name: 'Alice', now: 0 }), { name: 'Bob', now: 0 });
  game.current = 0;
  game.board = { '0,0': card('starter', 1) };
  game.deck = [];
  game.players[0].hand = [card('a', 2), card('b', 3)];
  game.players[1].hand = [card('c', 4)];
  return game;
}
test('review records exact placements, scoring bonuses, zero turns, and tied extrema', () => {
  const initial = fixture();
  let game = playCards(initial, 0, [{ x: 1, y: 0, cardId: 'a' }], 1);
  assert.equal(publicGame(game, -1).review, undefined);
  game = passTurn(game, 1, [], 2);
  game = passTurn(game, 0, [], 3);
  assert.equal(game.status, 'finished');
  const review = publicGame(game, -1).review;
  assert.equal(review.complete, true);
  assert.deepEqual(review.turns.map(t => t.points), [3, 0, 0]);
  assert.deepEqual(review.turns[0].placements, [{ spot: '1,0', card: card('a', 2), kind: 'play' }]);
  assert.deepEqual(review.players[0], { playerId: game.players[0].id, turns: 2, cardsPlaced: 1, averageCards: 0.5, averagePoints: 1.5, highest: 3, lowest: 0, highestTurns: [1], lowestTurns: [3] });
  assert.deepEqual(review.players[1].highestTurns, [2]);
  assert.deepEqual(review.players[1].lowestTurns, [2]);
  assert.equal(initial.turnHistory.length, 0);
  assert.equal(JSON.stringify(review).includes(initial.players[0].token), false);
  assert.equal(JSON.stringify(review).includes('"id":"b"'), false);
  review.turns[0].placements[0].card.number = 99;
  assert.equal(game.turnHistory[0].placements[0].card.number, 2);
  const end = playCards(fixture(), 0, [{ x: 1, y: 0, cardId: 'a' }, { x: 2, y: 0, cardId: 'b' }], 1);
  assert.equal(end.turnHistory[0].points, 12); // 6 points, doubled for going out.
  assert.deepEqual(end.turnHistory[0].scores, [12, 0]);
});
test('wild replacement stays attributed on a timeout without changing timeout scoring', () => {
  const game = fixture();
  game.board['0,0'] = { id: 'wild', wild: true };
  const swapped = swapWild(game, 0, { x: 0, y: 0, cardId: 'a' }, 1);
  assert.equal(swapped.turnHistory.length, 0);
  const expired = advanceExpired(swapped, swapped.deadline);
  assert.equal(expired.turnHistory[0].points, 0);
  assert.equal(expired.turnHistory[0].cardsPlaced, 1);
  assert.equal(expired.turnHistory[0].placements[0].kind, 'swap');
  assert.equal(expired.turnHistory[0].placements[0].card.id, 'a');
  const played = playCards(swapped, 0, [{ x: 1, y: 0, cardId: 'b' }], 2);
  assert.equal(played.turnHistory[0].cardsPlaced, 2);
  assert.deepEqual(played.turnHistory[0].placements.map(p => p.kind), ['swap', 'play']);
});
test('legacy rooms and no-turn players have honest unavailable statistics', () => {
  const legacy = fixture(); delete legacy.turnHistory; delete legacy.historyComplete;
  const empty = gameReview(legacy);
  assert.equal(empty.complete, false);
  assert.equal(empty.players[0].averageCards, null);
  assert.equal(empty.players[0].highest, null);
  assert.equal(gameReview(passTurn(legacy, 0, [], 1)).complete, false);
});
test('automatic missed turns are logged once, with all zero turns tied', () => {
  const game = fixture();
  const expired = advanceExpired(game, game.deadline + game.timerSeconds * 3000);
  assert.equal(expired.status, 'finished');
  assert.equal(expired.turnHistory.length, 3);
  assert.deepEqual(gameReview(expired).players[0].lowestTurns, [1, 3]);
  assert.equal(advanceExpired(expired, 1e12).turnHistory.length, 3);
});
