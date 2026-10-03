import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

test('HTTP AI games create, reply automatically, reload, and protect private hands', async () => {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'square-ai-test-'));
  const process = spawn(globalThis.process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd: directory, env: { ...globalThis.process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', RESEND_API_KEY: '' }, stdio: 'pipe'
  });
  const base = `http://127.0.0.1:${port}/square-game`;
  async function request(path, input, token) {
    const response = await fetch(base+path, { method: input ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: input ? JSON.stringify(input) : undefined });
    return { status: response.status, ...await response.json() };
  }
  try {
    for (let i=0; i<100; i++) {
      try { await request('/health'); break; } catch { await delay(20); }
    }
    for (const difficulty of ['easy','medium','hard','insane']) {
      const created = await request('/api/rooms', { mode: 'ai', name: 'Human', difficulty, timerSeconds: 60 });
      assert.equal(created.status, 201);
      assert.equal(created.room.current, 0);
      assert.equal(created.room.difficulty, difficulty);
      const path = `/api/rooms/${created.room.id}`;
      const anonymous = await request(path);
      assert.deepEqual(anonymous.room.hand, []);
      const moved = await request(path+'/action', { type: 'pass' }, created.token);
      assert.equal(moved.status, 200);
      assert.equal(moved.room.current, 0);
      assert.equal(moved.room.lastMove.playerId, moved.room.players[1].id);
      assert.ok(moved.room.lastMove.points > 0);
      assert.equal(moved.room.players[1].hand, undefined);
      const restored = await request(path, null, created.token);
      assert.deepEqual(restored.room, moved.room);
      const paused = await request(path+'/action', { type: 'request-pause' }, created.token);
      assert.equal(paused.room.status, 'paused');
      const resumed = await request(path+'/action', { type: 'resume' }, created.token);
      assert.equal(resumed.room.status, 'playing');
      const unauthorized = await request(path+'/action', { type: 'pass' });
      assert.equal(unauthorized.status, 401);
      const cannotJoin = await request(path+'/join', { name: 'Intruder' });
      assert.equal(cannotJoin.status, 400);
    }
    const friend = await request('/api/rooms', { mode: 'friend', name: 'Human', timerSeconds: 60 });
    assert.equal(friend.room.status, 'waiting');
    assert.equal((await request(`/api/rooms/${friend.room.id}/join`, { name: 'Friend' })).room.status, 'playing');
  } finally {
    const exited = new Promise(resolve => process.once('exit', resolve));
    process.kill(); await exited;
    const tempRoot = resolve(tmpdir());
    assert.ok(resolve(directory).startsWith(join(tempRoot, 'square-ai-test-')));
    await rm(directory, { recursive: true, force: true });
  }
});
