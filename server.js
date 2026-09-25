import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGame, joinGame, playerIndex, publicGame, playCards, swapWild,
  passTurn, advanceExpired
} from './game.js';
import { createRoom, getRoom, updateRoom, durableStorage } from './store.js';
import { mailReady, notifyNextPlayer } from './mail.js';

const port = Number(process.env.PORT || 10000);
const root = fileURLToPath(new URL('./public/', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65536) throw new Error('Request too large.');
  }
  try { return JSON.parse(text || '{}'); }
  catch { throw new Error('Invalid JSON.'); }
}
function auth(req, game) {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  return playerIndex(game, token);
}
async function loadFresh(id) {
  const row = await getRoom(id);
  if (!row) return null;
  const advanced = advanceExpired(row.state);
  if (JSON.stringify(advanced) !== JSON.stringify(row.state)) {
    if (!(await updateRoom(id, row.version, advanced))) return loadFresh(id);
    return { state: advanced, version: row.version + 1 };
  }
  return row;
}
async function sendNotification(game) {
  try { await notifyNextPlayer(game); return true; }
  catch (error) { console.error(error); return false; }
}
async function handler(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && (files.has(pathname) || /^\/room\/[\w-]+$/.test(pathname))) {
    const [file, type] = files.get(pathname) || files.get('/');
    const content = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': type, 'cache-control': file === 'index.html' ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
    res.end(content);
    return;
  }
  if (pathname === '/health') return send(res, 200, { ok: true, durableStorage, emailConfigured: mailReady() });
  if (pathname === '/api/rooms' && req.method === 'POST') {
    const input = await body(req);
    if (Number(input.timerSeconds) >= 86400 && (!durableStorage || !mailReady())) {
      return send(res, 503, { error: 'Day-length games require Supabase storage and Resend email configuration.' });
    }
    const game = createGame({ ...input, timerSeconds: Number(input.timerSeconds) });
    await createRoom(game);
    return send(res, 201, { room: publicGame(game, 0), token: game.players[0].token });
  }
  const match = pathname.match(/^\/api\/rooms\/([\w-]+)(?:\/(join|action))?$/);
  if (!match) return send(res, 404, { error: 'Not found.' });
  const [, id, operation] = match;
  const row = await loadFresh(id);
  if (!row) return send(res, 404, { error: 'Room not found.' });
  const game = row.state;
  if (req.method === 'GET' && !operation) return send(res, 200, { room: publicGame(game, auth(req, game)) });
  if (req.method === 'POST' && operation === 'join') {
    const next = joinGame(game, await body(req));
    if (!(await updateRoom(id, row.version, next))) return send(res, 409, { error: 'Room changed. Please retry.' });
    return send(res, 200, { room: publicGame(next, 1), token: next.players[1].token });
  }
  if (req.method === 'POST' && operation === 'action') {
    const index = auth(req, game);
    if (index < 0) return send(res, 401, { error: 'Open your personal game link to play.' });
    const input = await body(req);
    let next;
    if (input.type === 'play') next = playCards(game, index, input.placements);
    else if (input.type === 'swap') next = swapWild(game, index, input);
    else if (input.type === 'pass') next = passTurn(game, index, input.tradeIds ?? []);
    else throw new Error('Unknown action.');
    if (!(await updateRoom(id, row.version, next))) return send(res, 409, { error: 'Room changed. Please retry.' });
    const notified = input.type === 'swap' ? null : await sendNotification(next);
    return send(res, 200, { room: publicGame(next, index), notificationSent: notified });
  }
  return send(res, 405, { error: 'Method not allowed.' });
}

createServer((req, res) => {
  handler(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) send(res, /storage failed|Email delivery failed/i.test(error.message) ? 503 : 400, { error: error.message });
  });
}).listen(port, '0.0.0.0', () => console.log(`Square Game listening on ${port}`));
