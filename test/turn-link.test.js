import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, joinGame } from '../game.js';
import { issueTurnLink, readTurnLink, readSession, issueSession } from '../account.js';

test('turn links expire, reject tampering, and cannot be used as sessions', () => {
  const player = { id: 'player', email: 'a@example.com', accountEmail: 'a@example.com' };
  const game = { id: '1234', deadline: 100000 };
  const token = issueTurnLink(game, player, 1000);
  assert.equal(readTurnLink(token, 99999).email, player.email);
  assert.equal(readTurnLink(token, 100000), null);
  assert.equal(readTurnLink(`${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`, 1000), null);
  assert.equal(readSession(token, 1000), null);
  assert.equal(readTurnLink(issueSession(player.email, 1000), 1000), null);
  assert.equal(issueTurnLink(game, { ...player, email: 'other@example.com' }, 1000), null);
  assert.equal(issueTurnLink({ ...game, deadline: null }, player, 1000), null);
  const capped = issueTurnLink({ ...game, deadline: 30 * 86400000 }, player, 1000);
  assert.equal(readTurnLink(capped, 1000).expires, 1000 + 7 * 86400000);
});

test('turn link signs into its account and opens a day game; invalid room, origin, and credentials fail', async () => {
  const originalSecret = process.env.ACCOUNT_SECRET;
  const secret = 'turn-link-test-secret-at-least-32-characters';
  process.env.ACCOUNT_SECRET = secret;
  const cwd = await mkdtemp(join(tmpdir(), 'square-turn-link-'));
  const game = joinGame(createGame({ name: 'A', accountEmail: 'a@example.com', timerSeconds: 86400 }), { name: 'B', accountEmail: 'b@example.com' });
  const player = game.players[game.current];
  const credential = issueTurnLink(game, player);
  await mkdir(join(cwd, 'data'));
  await writeFile(join(cwd, 'data', 'rooms.json'), JSON.stringify({ [game.id]: { state: game, version: 0 } }));
  const port = 20000 + Math.floor(Math.random() * 30000);
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd, env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', REMINDER_SECRET: secret, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'test@example.com', BASE_URL: 'https://nathanielmann.ca/square-game' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}/square-game`;
  const redeem = async (token, roomId = game.id, origin = 'https://nathanielmann.ca') => {
    const response = await fetch(base + '/api/account/turn-link', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token, roomId }) });
    return { status: response.status, ...await response.json() };
  };
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await fetch(base + '/health'); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal((await redeem(credential, game.id, 'https://untrusted.example')).status, 403);
    assert.equal((await redeem(credential, 'wrong-room')).status, 401);
    assert.equal((await redeem('garbage')).status, 401);
    assert.equal((await redeem(issueTurnLink(game, { ...player, id: 'missing-player' }))).status, 401);
    const expired = issueTurnLink({ ...game, deadline: Date.now() - 1 }, player, Date.now() - 10000);
    assert.equal((await redeem(expired)).status, 401);
    const result = await redeem(credential);
    assert.equal(result.status, 200);
    assert.equal(readSession(result.token), player.accountEmail);
    assert.equal(result.playerToken, player.token);
    const response = await fetch(`${base}/api/rooms/${game.id}`, { headers: { 'x-account-token': result.token } });
    const opened = await response.json();
    assert.equal(opened.room.hand.length, 4);
    assert.equal(opened.room.players[game.current].isYou, true);
    const reminders = (authorization) => fetch(base + '/api/reminders/run', { method: 'POST', headers: { authorization } });
    assert.equal((await reminders('Bearer wrong-secret')).status, 401);
    assert.equal((await reminders('Bearer ' + result.token)).status, 401);
    const run = await reminders('Bearer ' + secret);
    assert.equal(run.status, 200);
    assert.deepEqual(await run.json(), { sent: 0, advanced: 0, failed: 0 });
  } finally {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill(); await exited;
    if (originalSecret === undefined) delete process.env.ACCOUNT_SECRET;
    else process.env.ACCOUNT_SECRET = originalSecret;
    await rm(cwd, { recursive: true, force: true });
  }
});
