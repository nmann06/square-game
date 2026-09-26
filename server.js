import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGame, joinGame, playerIndex, publicGame, playCards, swapWild,
  passTurn, advanceExpired, roomCode, inviteFriend, accountSummary
} from './game.js';
import { createRoom, getRoom, updateRoom, durableStorage, getLoginChallenge, saveLoginChallenge, updateLoginChallenge, verifyLoginChallenge, listAccountRooms } from './store.js';
import { mailReady, notifyNextPlayer, sendInvite, notifyInviteAccepted, sendFeedback, sendSignInCode } from './mail.js';
import { accountReady, accountEmail, newCode, codeHash, issueSession, readSession } from './account.js';

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
const codeRequests = new Map();
const codeAttempts = new Map();

function allowedRequestOrigin(req) {
  if (allowedOrigins.has(req.headers.origin)) return true;
  try {
    const origin = new URL(req.headers.origin);
    return origin.host === req.headers.host && (origin.protocol === 'https:' || (!process.env.RENDER && origin.protocol === 'http:'));
  } catch { return false; }
}

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
  const index = playerIndex(game, token);
  if (index >= 0) return index;
  const email = readSession(req.headers['x-account-token']);
  return email ? game.players.findIndex(player => player.accountEmail === email) : -1;
}
function requestIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim(); }
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
    if (allowedRequestOrigin(req)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'authorization, content-type, x-account-token');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(allowedRequestOrigin(req) ? 204 : 403);
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
  if (req.method === 'GET' && (files.has(path) || path === '/account' || /^\/room\/[\w-]+$/.test(path))) {
    const [file, type] = files.get(path) || files.get('/');
    const content = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': type, 'cache-control': file === 'index.html' ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
    res.end(content);
    return;
  }
  if (path === '/health') return send(res, 200, { ok: true, durableStorage, emailConfigured: mailReady(), accountConfigured: mailReady() && accountReady() && (durableStorage || !process.env.RENDER) });
  if (path === '/api/account/request-code' && req.method === 'POST') {
    if (!allowedRequestOrigin(req)) return send(res, 403, { error: 'Sign in from the Square Game page.' });
    if (!mailReady() || !accountReady() || (process.env.RENDER && !durableStorage)) return send(res, 503, { error: 'Email sign-in is not configured.' });
    const email = accountEmail((await body(req)).email);
    const now = Date.now();
    const ip = requestIp(req);
    const recent = (codeRequests.get(ip) ?? []).filter(at => at > now - 3600000);
    if (recent.length >= 10) return send(res, 429, { error: 'Too many codes requested. Try again later.' });
    const previous = await getLoginChallenge(email);
    if (previous?.sent_at && new Date(previous.sent_at).getTime() > now - 60000) return send(res, 429, { error: 'Wait a minute before requesting another code.' });
    const code = newCode();
    const challenge = { code_hash: codeHash(email, code), expires_at: new Date(now + 600000).toISOString(), attempts: 0, sent_at: new Date(now).toISOString() };
    await saveLoginChallenge(email, challenge);
    try { await sendSignInCode(email, code); }
    catch (error) {
      await updateLoginChallenge(email, challenge, { code_hash: null, expires_at: null });
      throw error;
    }
    codeRequests.set(ip, [...recent, now]);
    if (codeRequests.size > 1000) codeRequests.clear();
    return send(res, 200, { sent: true });
  }
  if (path === '/api/account/verify-code' && req.method === 'POST') {
    if (!allowedRequestOrigin(req)) return send(res, 403, { error: 'Sign in from the Square Game page.' });
    if (!accountReady()) return send(res, 503, { error: 'Email sign-in is not configured.' });
    const input = await body(req);
    const email = accountEmail(input.email);
    const code = String(input.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) return send(res, 400, { error: 'Enter the six-digit code.' });
    const key = `${requestIp(req)}:${email}`;
    const now = Date.now();
    const recent = (codeAttempts.get(key) ?? []).filter(at => at > now - 900000);
    if (recent.length >= 10) return send(res, 429, { error: 'Too many attempts. Request a new code later.' });
    codeAttempts.set(key, [...recent, now]);
    if (codeAttempts.size > 1000) codeAttempts.clear();
    const used = await verifyLoginChallenge(email, codeHash(email, code), now);
    if (!used) return send(res, 400, { error: 'Incorrect or expired code. Request a new one if needed.' });
    codeAttempts.delete(key);
    return send(res, 200, { email, token: issueSession(email) });
  }
  if (path === '/api/account/me' && req.method === 'GET') {
    const email = readSession(req.headers['x-account-token']);
    if (!email) return send(res, 401, { error: 'Sign in to see your games.' });
    return send(res, 200, { email, ...accountSummary(await listAccountRooms(email), email) });
  }
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
    const verifiedEmail = readSession(req.headers['x-account-token']);
    const game = createGame({ ...input, accountEmail: verifiedEmail ?? undefined, email: verifiedEmail ?? input.email, timerSeconds: Number(input.timerSeconds) });
    let created = false;
    for (let attempt = 0; attempt < 20 && !created; attempt++) {
      if (attempt) game.id = roomCode();
      created = await createRoom(game);
    }
    if (!created) return send(res, 503, { error: 'No room codes available. Please try again.' });
    return send(res, 201, { room: publicGame(game, 0), token: game.players[0].token });
  }
  const match = path.match(/^\/api\/rooms\/([\w-]+)(?:\/(join|action|invite|preview|link-account))?$/);
  if (!match) return send(res, 404, { error: 'Not found.' });
  const [, id, operation] = match;
  const row = await loadFresh(id);
  if (!row) return send(res, 404, { error: 'Room not found.' });
  const game = row.state;
  if (req.method === 'GET' && !operation) return send(res, 200, { room: publicGame(game, auth(req, game)) });
  if (req.method === 'POST' && operation === 'link-account') {
    const email = readSession(req.headers['x-account-token']);
    if (!email) return send(res, 401, { error: 'Sign in before linking a game.' });
    const index = playerIndex(game, req.headers.authorization?.replace(/^Bearer /, ''));
    if (index < 0) return send(res, 401, { error: 'Open your personal game link to add this room to your account.' });
    if (game.players[index].accountEmail && game.players[index].accountEmail !== email) return send(res, 409, { error: 'This room belongs to another account.' });
    if (game.players[index].accountEmail === email) return send(res, 200, { linked: true });
    const next = structuredClone(game);
    next.players[index].accountEmail = email;
    if (!(await updateRoom(id, row.version, next))) return send(res, 409, { error: 'Room changed. Please retry.' });
    return send(res, 200, { linked: true });
  }
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
    const input = await body(req);
    const verifiedEmail = readSession(req.headers['x-account-token']);
    const next = joinGame(game, { ...input, accountEmail: verifiedEmail ?? undefined, email: verifiedEmail ?? input.email });
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
