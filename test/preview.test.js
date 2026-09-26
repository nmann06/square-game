import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('move preview matches submitted points and rejects disconnected tiles', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'square-preview-'));
  const port = 20000 + Math.floor(Math.random() * 30000);
  const base = `http://127.0.0.1:${port}/square-game`;
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd, env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' }, stdio: 'ignore'
  });
  const request = async (path, body, token) => {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await request('/health'); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal(ready, true, 'server started');
    const host = await request('/api/rooms', { name: 'Host', timerSeconds: 60 });
    assert.equal(host.status, 201);
    const id = host.data.room.id;
    const guest = await request(`/api/rooms/${id}/join`, { name: 'Guest' });
    assert.equal(guest.status, 200);
    const active = guest.data.room.current === 0 ? { token: host.data.token, room: (await request(`/api/rooms/${id}`, null, host.data.token)).data.room } : { token: guest.data.token, room: guest.data.room };
    const cardId = active.room.hand[0].id;
    const invalid = await request(`/api/rooms/${id}/preview`, { placements: [{ x: 5, y: 5, cardId }] }, active.token);
    assert.equal(invalid.data.legal, false);
    assert.match(invalid.data.reason, /connect/);
    const placement = [{ x: 1, y: 0, cardId }];
    const preview = await request(`/api/rooms/${id}/preview`, { placements: placement }, active.token);
    assert.equal(preview.data.legal, true);
    const played = await request(`/api/rooms/${id}/action`, { type: 'play', placements: placement }, active.token);
    assert.equal(played.data.room.lastMove.points, preview.data.points);
  } finally {
    server.kill();
    if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
    await rm(cwd, { recursive: true, force: true });
  }
});
