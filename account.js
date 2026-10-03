import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

let localSecret;
const SESSION_MS = 365 * 24 * 60 * 60 * 1000;

function secret() {
  if (process.env.ACCOUNT_SECRET?.length >= 32) return process.env.ACCOUNT_SECRET;
  if (process.env.RENDER) return '';
  if (!localSecret) {
    // Keep local sessions valid across restarts, just as ACCOUNT_SECRET does in production.
    const directory = resolve('data');
    const path = resolve(directory, 'account-secret');
    mkdirSync(directory, { recursive: true });
    try { writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    localSecret = readFileSync(path, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/.test(localSecret)) throw new Error('The local account signing key is invalid.');
  }
  return localSecret;
}
export function accountReady() { return Boolean(secret()); }
export function accountEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}
export function newCode() { return String(randomInt(1000000)).padStart(6, '0'); }
export function accountProfile(input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 30 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Choose an account name between 1 and 30 characters.');
  const color = typeof input.color === 'string' ? input.color.toLowerCase() : '';
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error('Choose a valid icon colour.');
  return { name, color };
}
export function codeHash(email, code) {
  return createHmac('sha256', secret()).update(`square-code:${email}:${code}`).digest('hex');
}
export function codeMatches(email, code, hash) {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash) &&
    timingSafeEqual(Buffer.from(codeHash(email, code), 'hex'), Buffer.from(hash, 'hex'));
}
function signature(payload) {
  return createHmac('sha256', secret()).update(`square-session:${payload}`).digest('hex');
}
// Turn links are purpose-bound credentials, separate from account sessions.
function turnSignature(payload) {
  return createHmac('sha256', secret()).update(`square-turn-link:${payload}`).digest('hex');
}
export function issueTurnLink(game, player, now = Date.now()) {
  if (!accountReady() || !player.accountEmail || player.email !== player.accountEmail) return null;
  const expires = Math.min(Number(game.deadline), now + 7 * 86400000);
  if (!Number.isFinite(expires) || expires <= now) return null;
  const payload = Buffer.from(JSON.stringify({ room: game.id, player: player.id, email: player.accountEmail, expires })).toString('base64url');
  return `${payload}.${turnSignature(payload)}`;
}
export function readTurnLink(token, now = Date.now()) {
  if (!accountReady() || typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
  if (!timingSafeEqual(Buffer.from(turnSignature(parts[0]), 'hex'), Buffer.from(parts[1], 'hex'))) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (typeof data.room !== 'string' || typeof data.player !== 'string' || !Number.isFinite(data.expires) || data.expires <= now || accountEmail(data.email) !== data.email) return null;
    return data;
  } catch { return null; }
}
export function issueSession(email, now = Date.now()) {
  if (!accountReady()) throw new Error('Account sign-in is not configured.');
  const payload = `${Buffer.from(email).toString('base64url')}.${now + SESSION_MS}`;
  return `${payload}.${signature(payload)}`;
}
export function readSession(token, now = Date.now()) {
  if (!accountReady() || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(signature(payload), 'hex');
  const supplied = Buffer.from(parts[2], 'hex');
  if (!timingSafeEqual(expected, supplied) || Number(parts[1]) <= now) return null;
  try {
    const email = Buffer.from(parts[0], 'base64url').toString('utf8');
    return accountEmail(email) === email ? email : null;
  } catch { return null; }
}
export function renewSession(token, now = Date.now()) {
  const email = readSession(token, now);
  if (!email) return null;
  // Each successful return renews the remembered browser for another year.
  return issueSession(email, now);
}
