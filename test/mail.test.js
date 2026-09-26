import test from 'node:test';
import assert from 'node:assert/strict';
import { sendFeedback } from '../mail.js';

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
