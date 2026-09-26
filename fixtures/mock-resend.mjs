import { writeFile } from 'node:fs/promises';

const actualFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://api.resend.com/emails') {
    const message = JSON.parse(options.body);
    const code = message.text.match(/sign-in code is (\d{6})/)?.[1];
    if (code) await writeFile(process.env.TEST_CODE_FILE, code);
    return new Response(JSON.stringify({ id: 'test-message' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return actualFetch(url, options);
};
