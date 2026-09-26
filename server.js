import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGame, joinGame, playerIndex, publicGame, playCards, swapWild,
  passTurn, advanceExpired, roomCode, inviteFriend
} from './game.js';
import { createRoom, getRoom, updateRoom, durableStorage } from './store.js';
import { mailReady, notifyNextPlayer, sendInvite, notifyInviteAccepted, sendFeedback } from './mail.js';

const port = Number(process.env.PORT || 10000);
const basePath = '/square-game';
const allowedOrigins = new Set([
  'https://nathanielmann.ca', 'https://www.nathanielmann.ca',
  'http://localhost:8080', 'http://127.0.0.1:8080'
]);
const root = fileURLToPath(new URL('./public/', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/config.js', ['config.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);
const feedbackAttempts = new Map();

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
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (pathname.startsWith(basePath + '/api/')) {
    const origin = req.headers.origin;
    if (allowedOrigins.has(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(allowedOrigins.has(origin) ? 204 : 403);
      res.end();
      return;
    }
  }
  const prefix = pathname.split('/')[1];
  if (prefix && /^(?:square[-_ ]?games?|sqaure[-_ ]?games?)$/i.test(decodeURIComponent(prefix)) && prefix !== 'square-game') {
    res.writeHead(301, { location: `${basePath}${pathname.slice(prefix.length + 1)}${url.search}`, 'cache-control': 'no-store' });
    res.end();
    return;
  }
  if (pathname === basePath + '/') {
    res.writeHead(301, { location: `${basePath}${url.search}`, 'cache-control': 'no-store' });
    res.end();
    return;
  }
  const path = pathname === basePath ? '/' : pathname.startsWith(basePath + '/') ? pathname.slice(basePath.length) : null;
  if (path === null) return send(res, 404, { error: 'Not found.' });
  if (req.method === 'GET' && (files.has(path) || /^\/room\/[\w-]+$/.test(path))) {
    const [file, type] = files.get(path) || files.get('/');
    const content = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': type, 'cache-control': file === 'index.html' ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
    res.end(content);
    return;
  }
  if (path === '/health') return send(res, 200, { ok: true, durableStorage, emailConfigured: mailReady() });
  if (path === '/api/feedback' && req.method === 'POST') {
    if (!allowedOrigins.has(req.headers.origin)) return send(res, 403, { error: 'Feedback must be sent from the website.' });
    if (!mailReady()) return send(res, 503, { error: 'Feedback email is temporarily unavailable.' });
    const input = await body(req);
    if (input.website) return send(res, 200, { ok: true });
    const name = String(input.name ?? '').trim();
    const email = String(input.email ?? '').trim();
    const feedback = String(input.feedback ?? '').trim();
    if (!name || name.length > 100 || /[\r\n]/.test(name)) return send(res, 400, { error: 'Enter a name under 100 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return send(res, 400, { error: 'Enter a valid email address.' });
    if (!feedback || feedback.length > 5000) return send(res, 400, { error: 'Enter feedback under 5,000 characters.' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
    const recent = (feedbackAttempts.get(ip) ?? []).filter(at => at > Date.now() - 3600000);
    if (recent.length >= 3) return send(res, 429, { error: 'Too many messages. Please try again later.' });
    await sendFeedback({ name, email, feedback });
    feedbackAttempts.set(ip, [...recent, Date.now()]);
    if (feedbackAttempts.size > 1000) feedbackAttempts.clear();
    return send(res, 200, { ok: true });
  }
  if (path === '/api/rooms' && req.method === 'POST') {
    const input = await body(req);
    if (Number(input.timerSeconds) >= 86400 && (!durableStorage || !mailReady())) {
      return send(res, 503, { error: 'Day-length games require Supabase storage and Resend email configuration.' });
    }
    const game = createGame({ ...input, timerSeconds: Number(input.timerSeconds) });
    let created = false;
    for (let attempt = 0; attempt < 20 && !created; attempt++) {
      if (attempt) game.id = roomCode();
      created = await createRoom(game);
    }
    if (!created) return send(res, 503, { error: 'No room codes available. Please try again.' });
    return send(res, 201, { room: publicGame(game, 0), token: game.players[0].token });
  }
  const match = path.match(/^\/api\/rooms\/([\w-]+)(?:\/(join|action|invite|preview))?$/);
  if (!match) return send(res, 404, { error: 'Not found.' });
  const [, id, operation] = match;
  const row = await loadFresh(id);
  if (!row) return send(res, 404, { error: 'Room not found.' });
  const game = row.state;
  if (req.method === 'GET' && !operation) return send(res, 200, { room: publicGame(game, auth(req, game)) });
  if (req.method === 'POST' && operation === 'preview') {
    const index = auth(req, game);
    if (index < 0) return send(res, 401, { error: 'Open your personal game link to preview a move.' });
    const input = await body(req);
    try {
      const next = playCards(game, index, input.placements);
      return send(res, 200, { legal: true, points: next.lastMove.points });
    } catch (error) {
      return send(res, 200, { legal: false, reason: error.message });
    }
  }
  if (req.method === 'POST' && operation === 'join') {
    const next = joinGame(game, await body(req));
    if (!(await updateRoom(id, row.version, next))) return send(res, 409, { error: 'Room changed. Please retry.' });
    if (next.invites?.length) {
      try { await notifyInviteAccepted(next); }
      catch (error) { console.error(error); }
    }
    return send(res, 200, { room: publicGame(next, 1), token: next.players[1].token });
  }
  if (req.method === 'POST' && operation === 'invite') {
    if (!mailReady()) return send(res, 503, { error: 'Email invites are not set up on this server.' });
    const index = auth(req, game);
    if (index < 0) return send(res, 401, { error: 'Open your personal game link to send invites.' });
    const input = await body(req);
    const next = inviteFriend(game, index, input);
    if (!(await updateRoom(id, row.version, next))) return send(res, 409, { error: 'Room changed. Please retry.' });
    await sendInvite(next, next.invites.at(-1).email);
    return send(res, 200, { room: publicGame(next, index) });
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
