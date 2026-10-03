import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, joinGame, playCards, swapWild, validateBoard } from '../game.js';

const card = (id, color, number) => ({ id, color, shape: 'circle', number });
function exampleGame(color = 'red') {
  const game = joinGame(createGame({ name: 'A' }), { name: 'B' });
  game.board = {
    '2,0': card('blue3', 'blue', 3), '3,0': card('blue4', 'blue', 4),
    '0,1': card('red1', 'red', 1), '1,1': card('red2', 'red', 2), '2,1': card('red3', 'red', 3)
  };
  game.players[game.current].hand = [card('proposed', color, 4), card('spare', 'yellow', 1)];
  return game;
}

test('tutorial crossing example scores only affected lines and doubles the lot to 36', () => {
  const game = exampleGame();
  validateBoard(game.board);
  const result = playCards(game, game.current, [{ x: 3, y: 1, cardId: 'proposed' }]);
  assert.equal(result.lastMove.base, 18);
  assert.equal(result.lastMove.lots, 1);
  assert.equal(result.lastMove.points, 36);
});

test('tutorial incorrect moves are rejected by the actual game rules', () => {
  const mixed = exampleGame('green');
  assert.throws(() => playCards(mixed, mixed.current, [{ x: 3, y: 1, cardId: 'proposed' }]), /invalid line/);
  const fifth = exampleGame();
  fifth.board['3,1'] = card('existing4', 'red', 4);
  fifth.players[fifth.current].hand[0] = card('proposed', 'red', 1);
  assert.throws(() => playCards(fifth, fifth.current, [{ x: 4, y: 1, cardId: 'proposed' }]), /longer than four/);
  const diagonal = exampleGame();
  assert.throws(() => playCards(diagonal, diagonal.current, [{ x: 4, y: 1, cardId: 'proposed' }]), /connect to the board/);
});

test('tutorial wildcard example scores zero for the wild and combines a later exchange with the main move', () => {
  const game = joinGame(createGame({ name: 'A' }), { name: 'B' });
  game.board = {
    '0,1': card('green1', 'green', 1),
    '1,1': { id: 'green2', color: 'green', shape: 'square', number: 2 },
    '2,1': { id: 'green3', color: 'green', shape: 'triangle', number: 3 }
  };
  const wildPlayer = game.current;
  game.players[wildPlayer].hand = [{ id: 'wild', wild: true }, card('spare', 'yellow', 1)];
  const played = playCards(game, wildPlayer, [{ x: 3, y: 1, cardId: 'wild' }]);
  assert.equal(played.lastMove.points, 12);
  assert.deepEqual(played.board['3,1'].as, { color: 'green', shape: 'star', number: 4 });
  const exchanger = played.current;
  played.players[exchanger].hand = [
    { id: 'replacement', color: 'green', shape: 'star', number: 4 }, card('blue1', 'blue', 1)
  ];
  const swapped = swapWild(played, exchanger, { x: 3, y: 1, cardId: 'replacement' });
  assert.equal(swapped.pendingSwap.base, 10);
  assert.equal(swapped.pendingSwap.lots, 1);
  assert.equal(swapped.players[exchanger].hand[0].wild, true);
  const finished = playCards(swapped, exchanger, [{ x: 0, y: 2, cardId: 'blue1' }]);
  assert.equal(finished.lastMove.base, 12);
  assert.equal(finished.lastMove.points, 24);
});
