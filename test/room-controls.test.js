import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, joinGame, changePause, passTurn, playCards, swapWild, advanceExpired, accountSummary } from '../game.js';
import { issueSession } from '../account.js';

test('pause requires opponent consent and resume preserves the clock with two distinct votes', () => {
  const initial = joinGame(createGame({ name: 'A' }), { name: 'B', now: 1000 });
  assert.equal(initial.timerSeconds, 120);
  const requested = changePause(initial, 0, 'request-pause', 2000);
  assert.equal(requested.deadline, initial.deadline);
  assert.throws(() => changePause(requested, 0, 'accept-pause', 3000), /other player/);
  assert.throws(() => changePause(initial, -1, 'request-pause'), /Only players/);
  assert.equal(changePause(requested, 1, 'cancel-pause').pauseRequestedBy, null);
  assert.equal(passTurn(requested, requested.current, [], 3000).pauseRequestedBy, null);
  const paused = changePause(requested, 1, 'accept-pause', 4000);
  assert.equal(paused.remainingTurnMs, 117000);
  assert.equal(paused.deadline, null);
  assert.deepEqual(advanceExpired(paused, 99999999), paused);
  assert.throws(() => passTurn(paused, paused.current), /not active/);
  assert.throws(() => playCards(paused, paused.current, []), /not active/);
  assert.throws(() => swapWild(paused, paused.current, {}), /not active/);
  const vote = changePause(paused, 1, 'resume', 500000);
  assert.equal(changePause(vote, 1, 'resume', 500001).status, 'paused');
  const resumed = changePause(vote, 0, 'resume', 600000);
  assert.equal(resumed.status, 'playing');
  assert.equal(resumed.deadline, 717000);
  assert.equal(resumed.current, initial.current);
  assert.deepEqual(resumed.players, initial.players);
  assert.equal(advanceExpired(resumed, 716999).current, initial.current);
  assert.equal(advanceExpired(resumed, 717000).current, 1 - initial.current);
});

test('day-length games require accounts and win rate excludes all unfinished rooms', () => {
  assert.throws(() => createGame({ name: 'A', email: 'a@example.com', timerSeconds: 86400 }), /Sign in/);
  const waiting = createGame({ name: 'A', accountEmail: 'a@example.com', timerSeconds: 86400 });
  assert.throws(() => joinGame(waiting, { name: 'B', email: 'b@example.com' }), /Sign in/);
  const active = joinGame(waiting, { name: 'B', accountEmail: 'b@example.com', now: 1000 });
  const paused = changePause(changePause(active, 0, 'request-pause', 2000), 1, 'accept-pause', 3000);
  const won = { ...active, status: 'finished', winner: active.players[0].id };
  const tied = { ...active, status: 'finished', winner: null };
  const summary = accountSummary([waiting, active, paused, won, tied], 'a@example.com', 4000);
  assert.equal(summary.gamesPlayed, 2);
  assert.equal(summary.winPercent, 50);
  assert.equal(summary.currentGames.length, 3);
  assert.equal(accountSummary([waiting, paused], 'a@example.com', 4000).winPercent, 0);
});

test('room API enforces day sign-in, pause consent, and host-only deletion before joining', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'square-controls-'));
  const secret = 'room-controls-test-secret-at-least-32-bytes';
  const previousSecret = process.env.ACCOUNT_SECRET;
  process.env.ACCOUNT_SECRET = secret;
  const accountToken = issueSession('a@example.com');
  if (previousSecret === undefined) delete process.env.ACCOUNT_SECRET;
  else process.env.ACCOUNT_SECRET = previousSecret;
  const day = joinGame(createGame({ name: 'A', accountEmail: 'a@example.com', timerSeconds: 86400 }), { name: 'B', accountEmail: 'b@example.com' });
  const waitingDay = createGame({ name: 'A', accountEmail: 'a@example.com', timerSeconds: 86400 });
  waitingDay.id = day.id === '0000' ? '0001' : '0000';
  await mkdir(join(cwd, 'data'));
  await writeFile(join(cwd, 'data', 'rooms.json'), JSON.stringify({ [day.id]: { state: day, version: 0 }, [waitingDay.id]: { state: waitingDay, version: 0 } }));
  const port = 20000 + Math.floor(Math.random() * 30000);
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd, env: { ...process.env, PORT: String(port), ACCOUNT_SECRET: secret, SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' }, stdio: 'ignore'
  });
  const request = async (path, method = 'GET', body, token, account) => {
    const response = await fetch(`http://127.0.0.1:${port}/square-game${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(account ? { 'x-account-token': account } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, ...await response.json() };
  };
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await request('/health'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal((await request('/api/rooms', 'POST', { name: 'Guest', timerSeconds: 86400, email: 'a@example.com', accountEmail: 'a@example.com' })).status, 401);
    assert.equal((await request(`/api/rooms/${waitingDay.id}/join`, 'POST', { name: 'Guest', email: 'b@example.com', accountEmail: 'b@example.com' })).status, 401);
    assert.equal((await request(`/api/rooms/${day.id}/action`, 'POST', { type: 'request-pause' }, day.players[0].token)).status, 401);
    assert.equal((await request(`/api/rooms/${day.id}/action`, 'POST', { type: 'request-pause' }, null, accountToken)).status, 200);
    const host = await request('/api/rooms', 'POST', { name: 'Host' });
    assert.equal(host.room.timerSeconds, 120);
    const path = `/api/rooms/${host.room.id}`;
    assert.equal((await request(path, 'DELETE')).status, 403);
    const guest = await request(path + '/join', 'POST', { name: 'Guest' });
    assert.equal((await request(path, 'DELETE', null, host.token)).status, 409);
    assert.equal((await request(path + '/action', 'POST', { type: 'request-pause' })).status, 401);
    await request(path + '/action', 'POST', { type: 'request-pause' }, host.token);
    assert.equal((await request(path + '/action', 'POST', { type: 'accept-pause' }, host.token)).status, 400);
    assert.equal((await request(path + '/action', 'POST', { type: 'accept-pause' }, guest.token)).room.status, 'paused');
    assert.equal((await request(path + '/action', 'POST', { type: 'pass' }, host.token)).status, 400);
    assert.equal((await request(path + '/action', 'POST', { type: 'resume' }, host.token)).room.status, 'paused');
    assert.equal((await request(path + '/action', 'POST', { type: 'resume' }, guest.token)).room.status, 'playing');
    const empty = await request('/api/rooms', 'POST', { name: 'Host' });
    assert.equal((await request(`/api/rooms/${empty.room.id}`, 'DELETE', null, empty.token)).status, 200);
    assert.equal((await request(`/api/rooms/${empty.room.id}`)).status, 404);
    const racing = await request('/api/rooms', 'POST', { name: 'Host' });
    const racePath = `/api/rooms/${racing.room.id}`;
    const [deleted, joined] = await Promise.all([
      request(racePath, 'DELETE', null, racing.token), request(racePath + '/join', 'POST', { name: 'Guest' })
    ]);
    assert.notEqual(deleted.status === 200, joined.status === 200, 'exactly one competing mutation succeeds');
  } finally {
    server.kill();
    if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
    await rm(cwd, { recursive: true, force: true });
  }
});
