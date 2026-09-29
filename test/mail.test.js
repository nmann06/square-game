import test from 'node:test';
import assert from 'node:assert/strict';
import { sendFeedback, sendSignInCode, notifyNextPlayer } from '../mail.js';
import { readTurnLink } from '../account.js';
import { createGame, joinGame } from '../game.js';

test('feedback email includes sender details and replies to the visitor', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true };
  };
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'Website <test@nathanielmann.ca>';
  try {
    await sendFeedback({ name: 'Visitor', email: 'visitor@example.com', feedback: 'Great project.' });
    assert.equal(request.url, 'https://api.resend.com/emails');
    const payload = JSON.parse(request.options.body);
    assert.deepEqual(payload.to, ['nate@nathanielmann.ca']);
    assert.equal(payload.reply_to, 'visitor@example.com');
    assert.match(payload.text, /Name: Visitor\nEmail: visitor@example.com\n\nFeedback:\nGreat project\./);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
  }
});

test('verification and turn emails include escaped HTML, text, and a personal sign-in link', async () => {
  const originalFetch = globalThis.fetch;
  const env = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM, BASE_URL: process.env.BASE_URL };
  const messages = [];
  globalThis.fetch = async (_url, options) => { messages.push(JSON.parse(options.body)); return { ok: true }; };
  Object.assign(process.env, { RESEND_API_KEY: 'test-key', EMAIL_FROM: 'test@example.com', BASE_URL: 'https://nathanielmann.ca/square-game' });
  try {
    await sendSignInCode('a@example.com', '012345');
    assert.match(messages[0].html, /012345/);
    assert.match(messages[0].text, /012345/);
    const game = joinGame(createGame({ name: 'A', accountEmail: 'a@example.com', timerSeconds: 86400 }), { name: 'B', accountEmail: 'b@example.com' });
    game.lastMove = { playerName: '<img src=x onerror=alert(1)>' };
    await notifyNextPlayer(game);
    const mail = messages[1];
    assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(mail.html, /<img|A little strategy/);
    assert.match(mail.html, /Play your turn/);
    const link = new URL(mail.text.match(/Rejoin: (\S+)/)[1]);
    assert.equal(link.search, '');
    const token = new URLSearchParams(link.hash.slice(1)).get('signin');
    assert.equal(readTurnLink(token).email, game.players[game.current].accountEmail);
    assert.ok(mail.html.includes(link.href));
    assert.deepEqual(mail.to, [game.players[game.current].email]);
    game.deadline = Date.now() + 7200000;
    let reminderRequest;
    globalThis.fetch = async (_url, options) => { reminderRequest = options; return { ok: true }; };
    assert.equal(await notifyNextPlayer(game, { reminder: true, idempotencyKey: 'test-reminder' }), true);
    const reminder = JSON.parse(reminderRequest.body);
    assert.match(reminder.subject, /Your turn ends soon/);
    assert.match(reminder.html, /TURN REMINDER/);
    assert.match(reminder.text, /2 hours or less/);
    assert.match(reminder.html, /#signin=/);
    assert.doesNotMatch(reminder.html, /has moved/);
    assert.equal(reminderRequest.headers['Idempotency-Key'], 'test-reminder');
    game.status = 'paused';
    await notifyNextPlayer(game);
    assert.equal(messages.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
