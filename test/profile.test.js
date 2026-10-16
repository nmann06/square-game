import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountProfile, issueSession, storedProfile } from '../account.js';

test('account profile validates names and icon colours without requiring unique names', () => {
  assert.deepEqual(accountProfile({ name: ' Alex ', color: '#FFAA00' }), { name: 'Alex', color: '#ffaa00', language: 'en', tileColors: null });
  for (const name of ['', '   ', 'x'.repeat(31), 'line\nbreak']) assert.throws(() => accountProfile({ name, color: '#123456' }));
  for (const color of ['', 'red', '#123', 'url(example)']) assert.throws(() => accountProfile({ name: 'Alex', color }));
});

test('account profile validates language and a full set of tile colours', () => {
  const tileColors = { red: '#DC267F', yellow: '#ffb000', blue: '#0072b2', green: '#009e73' };
  assert.deepEqual(accountProfile({ name: 'Alex', color: '#123456', language: 'zh', tileColors }),
    { name: 'Alex', color: '#123456', language: 'zh', tileColors: { ...tileColors, red: '#dc267f' } });
  for (const language of ['fr', '', 'ZH']) assert.throws(() => accountProfile({ name: 'Alex', color: '#123456', language }));
  for (const colors of ['red', [], { red: '#dc267f' }, { ...tileColors, blue: 'blue' }]) assert.throws(() => accountProfile({ name: 'Alex', color: '#123456', tileColors: colors }));
  // Older rows without the new columns read as English with the standard palette.
  assert.deepEqual(storedProfile({ name: 'Old', color: '#285b36' }), { name: 'Old', color: '#285b36', language: 'en', tileColors: null });
  assert.deepEqual(storedProfile({ name: 'Row', color: '#285b36', language: 'zh', tile_colors: tileColors }).tileColors.red, '#dc267f');
});

test('every server and game error message has a Mandarin translation', async () => {
  const sources = await Promise.all(['server.js', 'game.js', 'account.js'].map(file => readFile(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')));
  const i18n = await readFile(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const browser = {};
  new Function('window', 'document', 'localStorage', i18n)(browser, { documentElement: { style: { setProperty() {} } }, querySelectorAll: () => [] }, { getItem: () => null });
  const exempt = new Set(['The local account signing key is invalid.', 'Reminders are not configured.', 'Unauthorized.', 'Feedback must be sent from the website.', 'Feedback email is temporarily unavailable.', 'Enter a name under 100 characters.', 'Enter feedback under 5,000 characters.', 'Too many messages. Please try again later.']);
  const messages = new Set();
  for (const source of sources) for (const [, , text] of source.matchAll(/(?:Error|fail|error:)\s*\(?\s*(['"])((?:\\.|(?!\1).)+)\1/g)) messages.add(text.replace(/\\'/g, "'"));
  browser.SquareI18n.applySettings({ language: 'zh' });
  const missing = [...messages].filter(text => !exempt.has(text) && browser.SquareI18n.serverMessage(text) === text);
  assert.deepEqual(missing, []);
  assert.equal(browser.SquareI18n.serverMessage('You can send up to 5 invites per room.'), '每个房间最多可以发送 5 份邀请。');
});

test('email-keyed profiles are private, persistent, and determine signed-in room names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'square-profile-test-'));
  const secret = 'square-profile-test-signing-secret-at-least-32';
  const originalSecret = process.env.ACCOUNT_SECRET;
  process.env.ACCOUNT_SECRET = secret;
  const tokenA = issueSession('first@example.com'), tokenB = issueSession('second@example.com');
  if (originalSecret === undefined) delete process.env.ACCOUNT_SECRET; else process.env.ACCOUNT_SECRET = originalSecret;
  const port = 20000 + Math.floor(Math.random()*30000);
  let server;
  async function start() {
    server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
      cwd: directory, env: { ...process.env, ACCOUNT_SECRET: secret, PORT: String(port), SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' }, stdio: 'ignore'
    });
    for (let i=0; i<80; i++) { try { await fetch(`http://127.0.0.1:${port}/square-game/health`); return; } catch { await new Promise(r => setTimeout(r, 25)); } }
    throw new Error('Test server did not start.');
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const exited = new Promise(r => server.once('exit',r)); server.kill(); await exited;
  }
  async function request(path, body, token) {
    const response = await fetch(`http://127.0.0.1:${port}/square-game${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, ...(token ? { 'x-account-token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, ...await response.json() };
  }
  try {
    await start();
    assert.equal((await request('/api/account/profile', { name: 'Intruder', color: '#000000' })).status, 401);
    assert.equal((await request('/api/rooms', { name: 'Room name', timerSeconds: 60 }, tokenA)).status, 400);
    assert.equal((await request('/api/account/profile', { name: 'Alex', color: '#abcdef', email: 'second@example.com' }, tokenA)).status, 200);
    assert.equal((await request('/api/account/me', null, tokenB)).profile.name, '');
    assert.equal((await request('/api/account/profile', { name: 'Alex', color: '#112233' }, tokenB)).status, 200);
    const host = await request('/api/rooms', { name: 'Forged name', timerSeconds: 60 }, tokenA);
    assert.equal(host.status, 201); assert.equal(host.room.players[0].name, 'Alex');
    const joined = await request(`/api/rooms/${host.room.id}/join`, { name: 'Another forged name' }, tokenB);
    assert.equal(joined.status, 200); assert.equal(joined.room.players[1].name, 'Alex');
    await request('/api/account/profile', { name: 'Robin', color: '#ffaa00' }, tokenA);
    const bot = await request('/api/rooms', { mode: 'ai', difficulty: 'hard', timerSeconds: 60 }, tokenA);
    assert.equal(bot.room.players[0].name, 'Robin');
    const profiles = JSON.parse(await readFile(join(directory, 'data/account-profiles.json'), 'utf8'));
    assert.deepEqual(Object.keys(profiles).sort(), ['first@example.com', 'second@example.com']);
    await stop(); await start();
    const tileColors = { red: '#dc267f', yellow: '#ffb000', blue: '#0072b2', green: '#009e73' };
    assert.equal((await request('/api/account/profile', { name: 'Robin', color: '#ffaa00', language: 'zh', tileColors }, tokenA)).status, 200);
    assert.equal((await request('/api/account/profile', { name: 'Robin', color: '#ffaa00', language: 'xx' }, tokenA)).status, 400);
    await stop(); await start();
    const me = await request('/api/account/me', null, tokenA);
    assert.deepEqual(me.profile, { name: 'Robin', color: '#ffaa00', language: 'zh', tileColors });
    assert.equal(me.email, 'first@example.com');
  } finally {
    await stop();
    assert.ok(resolve(directory).startsWith(join(resolve(tmpdir()), 'square-profile-test-')));
    await rm(directory, { recursive: true, force: true });
  }
});
