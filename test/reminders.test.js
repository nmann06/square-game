import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, joinGame, passTurn, changePause } from '../game.js';
import { reminderDue, reminderTurnKey, runReminders } from '../reminders.js';

const NOW = 1800000000000;
const TWO_HOURS = 7200000;
function game() {
  const state = joinGame(createGame({ name: 'A', accountEmail: 'a@example.com', timerSeconds: 86400, now: NOW - 86400000 }), { name: 'B', accountEmail: 'b@example.com', now: NOW - 86400000 });
  state.deadline = NOW + TWO_HOURS;
  return state;
}
function harness(state = game()) {
  let row = { state, version: 0 };
  const sent = [];
  const deps = {
    list: async () => [state.id], get: async () => structuredClone(row), now: () => NOW,
    update: async (_id, version, next) => {
      if (row.version !== version) return false;
      row = { state: structuredClone(next), version: version + 1 }; return true;
    },
    send: async (next, options) => { sent.push({ state: structuredClone(next), options }); return true; },
    onError: () => {}
  };
  return { deps, sent, current: () => row, change: next => { row = { state: next, version: row.version + 1 }; } };
}

test('reminder starts at two hours and excludes early, expired, paused, finished, and minute games', () => {
  const state = game();
  assert.equal(reminderDue(state, NOW), true);
  assert.equal(reminderDue(state, NOW - 1), false);
  assert.equal(reminderDue(state, state.deadline - 1), true);
  assert.equal(reminderDue(state, state.deadline), false);
  for (const status of ['waiting', 'paused', 'finished']) assert.equal(reminderDue({ ...state, status }, NOW), false);
  assert.equal(reminderDue({ ...state, timerSeconds: 600 }, NOW), false);
  state.players[state.current].email = 'unverified@example.com';
  assert.equal(reminderDue(state, NOW), false);
});

test('reminder is sent once, survives repeated runs, and a new turn can get a reminder', async () => {
  const h = harness();
  assert.equal((await runReminders(h.deps)).sent, 1);
  assert.equal((await runReminders(h.deps)).sent, 0);
  assert.equal(h.sent[0].options.reminder, true);
  assert.match(h.sent[0].options.idempotencyKey, /^turn-reminder\/[a-f0-9]{64}\/\d+$/);
  const next = passTurn(h.current().state, h.current().state.current, [], NOW);
  next.deadline = NOW + TWO_HOURS;
  h.change(next);
  assert.equal((await runReminders(h.deps)).sent, 1);
  assert.notEqual(h.sent[0].options.idempotencyKey, h.sent[1].options.idempotencyKey);
});

test('pause and resume do not repeat a delivered reminder on the same turn', async () => {
  const h = harness();
  await runReminders(h.deps);
  const requested = changePause(h.current().state, 0, 'request-pause', NOW);
  const paused = changePause(requested, 1, 'accept-pause', NOW);
  h.change(paused);
  assert.equal((await runReminders(h.deps)).sent, 0);
  const resumed = changePause(changePause(paused, 0, 'resume', NOW + 60000), 1, 'resume', NOW + 60000);
  resumed.deadline = NOW + TWO_HOURS;
  h.change(resumed);
  assert.equal((await runReminders(h.deps)).sent, 0);
});

test('delivery failures retry with the same key without marking the turn sent', async () => {
  const h = harness();
  const keys = [];
  h.deps.send = async (_state, options) => { keys.push(options.idempotencyKey); if (keys.length === 1) throw new Error('Resend unavailable'); return true; };
  assert.equal((await runReminders(h.deps)).failed, 1);
  assert.equal(h.current().state.turnReminder, undefined);
  assert.equal((await runReminders(h.deps)).sent, 1);
  assert.equal(keys[0], keys[1]);
});

test('a move or pause between scanning and sending cancels the stale reminder', async () => {
  for (const mutate of [state => passTurn(state, state.current, [], NOW), state => ({ ...state, status: 'paused', deadline: null })]) {
    const h = harness();
    const get = h.deps.get;
    let reads = 0;
    h.deps.get = async id => { if (++reads === 2) h.change(mutate(h.current().state)); return get(id); };
    assert.equal((await runReminders(h.deps)).sent, 0);
  }
});

test('a move while delivering is preserved and never marked as already reminded', async () => {
  const h = harness();
  const original = reminderTurnKey(h.current().state);
  h.deps.send = async () => { h.change(passTurn(h.current().state, h.current().state.current, [], NOW)); return true; };
  await runReminders(h.deps);
  assert.notEqual(reminderTurnKey(h.current().state), original);
  assert.equal(h.current().state.turnReminder, undefined);
});

test('expired turns advance before reminding; the next player receives a due reminder', async () => {
  const state = game();
  state.deadline = NOW - 22 * 3600000;
  const original = state.current;
  const h = harness(state);
  const result = await runReminders(h.deps);
  assert.equal(result.advanced, 1);
  assert.equal(result.sent, 1);
  assert.equal(h.sent[0].state.current, 1 - original);
  assert.equal(h.sent[0].state.deadline, NOW + TWO_HOURS);
});
