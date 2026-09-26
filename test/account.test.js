import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountSummary, createGame, joinGame } from '../game.js';

test('account summary counts finished games and lists active rooms', () => {
  const email = 'player@example.com';
  const active = createGame({ name: 'Player', email, accountEmail: email, timerSeconds: 60, now: 1000 });
  const other = joinGame(active, { name: 'Other', now: 2000 });
  other.deadline = Date.now() + 60000;
  const won = structuredClone(other); won.status = 'finished'; won.winner = won.players[0].id;
  const lost = structuredClone(other); lost.status = 'finished'; lost.winner = lost.players[1].id;
  const summary = accountSummary([active, other, won, lost], email);
  assert.equal(summary.gamesPlayed, 2);
  assert.equal(summary.wins, 1);
  assert.equal(summary.winPercent, 50);
  assert.equal(summary.currentGames.length, 2);
  assert.deepEqual(summary.finishedGames.map(game => game.outcome), ['win', 'loss']);
});

test('email code signs in once and account can reopen its room', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'square-account-'));
  const codeFile = join(cwd, 'code.txt');
  const port = 20000 + Math.floor(Math.random() * 30000);
  const base = `http://127.0.0.1:${port}/square-game`;
  const server = spawn(process.execPath, [
    '--import', new URL('../fixtures/mock-resend.mjs', import.meta.url).href,
    fileURLToPath(new URL('../server.js', import.meta.url))
  ], {
    cwd,
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', ACCOUNT_SECRET: 'test-secret-that-is-long-enough-for-tests', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Square Game <test@example.com>', BASE_URL: 'https://nathanielmann.ca/square-game', TEST_CODE_FILE: codeFile },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += chunk; });
  server.stderr.on('data', chunk => { serverOutput += chunk; });
  const request = async (path, payload, accountToken, playerToken) => {
    const response = await fetch(base + path, {
      method: payload ? 'POST' : 'GET',
      headers: { origin: 'https://nathanielmann.ca', ...(payload ? { 'content-type': 'application/json' } : {}), ...(accountToken ? { 'x-account-token': accountToken } : {}), ...(playerToken ? { authorization: `Bearer ${playerToken}` } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await request('/health'); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal(ready, true, serverOutput);
    const email = 'player@example.com';
    assert.equal((await request('/api/account/request-code', { email })).status, 200);
    let code;
    for (let attempt = 0; attempt < 20; attempt++) {
      try { code = await readFile(codeFile, 'utf8'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 25)); }
    }
    assert.match(code, /^\d{6}$/);
    assert.equal((await request('/api/account/verify-code', { email, code: '999999' === code ? '888888' : '999999' })).status, 400);
    const verified = await request('/api/account/verify-code', { email, code });
    assert.equal(verified.status, 200);
    assert.equal((await request('/api/account/verify-code', { email, code })).status, 400);
    const token = verified.data.token;
    const created = await request('/api/rooms', { name: 'Player', email: 'unverified@example.com', timerSeconds: 60 }, token);
    assert.equal(created.status, 201);
    const id = created.data.room.id;
    const me = await request('/api/account/me', null, token);
    assert.equal(me.data.email, email);
    assert.equal(me.data.gamesPlayed, 0);
    assert.deepEqual(me.data.currentGames.map(game => game.id), [id]);
    const reopened = await request(`/api/rooms/${id}`, null, token);
    assert.equal(reopened.data.room.hand.length, 4);
    const visitor = await request(`/api/rooms/${id}`);
    assert.equal(visitor.data.room.hand.length, 0);
    const forged = await request('/api/rooms', { name: 'Guest', accountEmail: email, timerSeconds: 60 });
    assert.equal(forged.status, 201);
    const stillMe = await request('/api/account/me', null, token);
    assert.deepEqual(stillMe.data.currentGames.map(game => game.id), [id]);
    assert.equal((await request(`/api/rooms/${forged.data.room.id}/link-account`, {}, token)).status, 401);
    assert.equal((await request(`/api/rooms/${forged.data.room.id}/link-account`, {}, token, forged.data.token)).status, 200);
    const linked = await request('/api/account/me', null, token);
    assert.equal(linked.data.currentGames.length, 2);
  } finally {
    server.kill();
    if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
    await rm(cwd, { recursive: true, force: true });
  }
});
