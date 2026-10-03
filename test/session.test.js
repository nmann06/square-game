import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueSession, readSession, renewSession } from '../account.js';

const day = 86400000;
const email = 'remembered@example.com';

test('remembered sessions last a year and renew only while authenticated', () => {
  const now = 1000;
  const token = issueSession(email, now);
  assert.equal(readSession(token, now + 364 * day), email);
  assert.equal(readSession(token, now + 365 * day), null);
  const renewed = renewSession(token, now + 364 * day);
  assert.equal(readSession(renewed, now + 700 * day), email);
  assert.equal(renewSession(token, now + 365 * day), null);
  const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
  assert.equal(renewSession(tampered, now), null);
  assert.equal(renewSession('invalid', now), null);
});

test('existing valid 30-day sessions upgrade without another sign-in code', () => {
  const previousSecret = process.env.ACCOUNT_SECRET;
  const signingKey = 'remember-browser-migration-test-secret';
  process.env.ACCOUNT_SECRET = signingKey;
  try {
    const payload = `${Buffer.from(email).toString('base64url')}.${1000 + 30 * day}`;
    const signature = createHmac('sha256', signingKey).update(`square-session:${payload}`).digest('hex');
    const legacy = `${payload}.${signature}`;
    const renewed = renewSession(legacy, 1000 + 29 * day);
    assert.equal(readSession(renewed, 1000 + 300 * day), email);
  } finally {
    if (previousSecret === undefined) delete process.env.ACCOUNT_SECRET;
    else process.env.ACCOUNT_SECRET = previousSecret;
  }
});

test('local remembered sessions survive separate server processes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'square-session-'));
  const moduleUrl = new URL('../account.js', import.meta.url).href;
  const env = { ...process.env, ACCOUNT_SECRET: '', RENDER: '' };
  try {
    const issued = spawnSync(process.execPath, ['--input-type=module', '-e', `import { issueSession } from ${JSON.stringify(moduleUrl)}; process.stdout.write(issueSession(${JSON.stringify(email)}));`], { cwd, env, encoding: 'utf8' });
    assert.equal(issued.status, 0, issued.stderr);
    const reopened = spawnSync(process.execPath, ['--input-type=module', '-e', `import { readSession } from ${JSON.stringify(moduleUrl)}; process.stdout.write(String(readSession(process.argv[1])));`, issued.stdout], { cwd, env, encoding: 'utf8' });
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.equal(reopened.stdout, email);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
