import test from 'node:test';
import assert from 'node:assert/strict';
import { aiObservation, applyAiTurn, chooseAiTurn, createAiGame, legalTurns, unseenCards } from '../ai.js';
import { publicGame } from '../game.js';
import { runAi } from '../ai-runner.js';

const c = (id, color, shape, number) => ({ id, color, shape, number });
function fixture() {
  return { status: 'playing', current: 0, board: {
    '0,0': c('a','red','circle',1), '1,0': c('b','blue','square',2), '2,0': c('c','green','triangle',3)
  }, deck: [], players: [
    { id: 'p0', name: 'AI', hand: [c('d','yellow','star',4), c('e','red','star',2)], score: 0 },
    { id: 'p1', name: 'Human', hand: [c('f','green','circle',4)], score: 0 }
  ], pendingSwap: null, consecutivePasses: 0, timerSeconds: 60, deadline: 100000 };
}

test('AI rooms start immediately with four selectable difficulties and private bot cards', () => {
  for (const difficulty of ['easy','medium','hard','insane']) {
    const game = createAiGame({ name: 'Human', difficulty, timerSeconds: 60, now: 1000 });
    assert.equal(game.status, 'playing'); assert.equal(game.current, 0);
    assert.equal(game.players[1].isBot, true); assert.equal(game.players[1].hand.length, 4);
    const view = publicGame(game, 0);
    assert.equal(view.difficulty, difficulty); assert.equal(view.mode, 'ai');
    assert.equal(view.players[1].hand, undefined); assert.equal(view.players[1].token, undefined);
  }
  assert.throws(() => createAiGame({ name: 'Human', difficulty: 'fake', timerSeconds: 60 }));
  assert.throws(() => createAiGame({ name: 'Human', difficulty: 'hard', timerSeconds: 86400 }));
});

test('hard maximizes immediate legal score; easier levels choose suboptimal legal moves', () => {
  const game = fixture(), view = aiObservation(game);
  const before = structuredClone(game);
  const turns = legalTurns(view);
  for (const turn of turns) {
    const result = applyAiTurn(game, turn, 0);
    assert.equal(result.lastMove.points, turn.points);
  }
  const hard = chooseAiTurn(view, 'hard', () => .4);
  assert.equal(hard.points, Math.max(...turns.map(t => t.points)));
  assert.ok(hard.points >= 20);
  for (const difficulty of ['easy','medium']) {
    const turn = chooseAiTurn(view, difficulty, () => .4);
    assert.ok(turn.points < hard.points);
    assert.doesNotThrow(() => applyAiTurn(game, turn));
  }
  assert.deepEqual(game, before);
});

test('hard searches wild exchange plus placement as a single scored turn', () => {
  const game = fixture();
  game.board['3,0'] = { id: 'wild', wild: true, as: { color: 'yellow', shape: 'star', number: 4 } };
  const turns = legalTurns(aiObservation(game));
  assert.ok(turns.some(t => t.swap && t.placements.length));
  for (const turn of turns) assert.equal(applyAiTurn(game, turn).lastMove.points, turn.points);
  assert.equal(chooseAiTurn(aiObservation(game), 'hard').points, turns[0].points);
});

test('strategies cannot inspect real hidden hands or draw order; insane counts unseen identities', () => {
  const game = fixture();
  game.deck = [c('hidden','blue','triangle',4), { id: 'hidden-wild', wild: true }];
  const observation = aiObservation(game);
  const changed = structuredClone(game);
  changed.deck.reverse(); changed.players[1].hand[0] = c('secret','yellow','square',1);
  assert.deepEqual(aiObservation(changed), observation);
  const unseen = unseenCards(observation);
  assert.equal(unseen.length, 61);
  assert.ok(!unseen.some(card => !card.wild && card.color === 'red' && card.shape === 'circle' && card.number === 1));
  const turn = chooseAiTurn(observation, 'insane', () => .42);
  assert.doesNotThrow(() => applyAiTurn(game, turn));
  assert.deepEqual(chooseAiTurn(aiObservation(changed), 'insane', () => .42), turn);
});

test('insane values winning endgame over a reply and completes legal worker turns', async () => {
  const game = fixture(); game.players[0].hand = [c('d','yellow','star',4)];
  const turn = chooseAiTurn(aiObservation(game), 'insane', () => .5);
  const final = applyAiTurn(game, turn);
  assert.equal(final.status, 'finished'); assert.equal(final.winner, 'p0');
  game.difficulty = 'hard'; game.players[0].isBot = true;
  const result = await runAi(game);
  assert.equal(result.status, 'finished');
});

test('blocked AI trades only available cards, then passes to finish a depleted game', () => {
  const game = fixture(); game.board = {};
  for (let x=0;x<4;x++) for (let y=0;y<4;y++) game.board[`${x},${y}`] = c(`grid-${x}-${y}`, 'red','circle',1);
  game.deck = [c('draw','blue','star',4)];
  const turn = chooseAiTurn(aiObservation(game), 'hard');
  assert.equal(turn.placements.length, 0);
  assert.equal(turn.tradeIds.length, 1);
  assert.equal(applyAiTurn(game, turn).players[0].hand.some(c => c.id === 'draw'), true);
  game.deck = []; game.consecutivePasses = 1;
  assert.equal(applyAiTurn(game, chooseAiTurn(aiObservation(game), 'insane')).status, 'finished');
});

test('bot card counting respects the selected number of wildcards', () => {
  for (const wildcardCount of [0, 2, 10]) {
    const game = createAiGame({ name: 'Human', difficulty: 'hard', timerSeconds: 120, wildcardCount });
    const observation = aiObservation(game);
    const visibleWilds = [...Object.values(game.board), ...observation.hand].filter(card => card.wild).length;
    assert.equal(unseenCards(observation).filter(card => card.wild).length, wildcardCount - visibleWilds);
  }
});

test('hard considers multiple wild exchanges under the current rules', () => {
  const game = fixture();
  game.board = { '0,0': { id: 'w1', wild: true }, '1,0': { id: 'w2', wild: true } };
  const turns = legalTurns(aiObservation(game));
  assert.ok(turns.some(turn => turn.swaps.length === 2));
  const turn = chooseAiTurn(aiObservation(game), 'hard');
  assert.equal(applyAiTurn(game, turn).lastMove.points, turns[0].points);
});
