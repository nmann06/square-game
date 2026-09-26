import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const localSecret = randomBytes(32).toString('hex');
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function secret() { return process.env.ACCOUNT_SECRET?.length >= 32 ? process.env.ACCOUNT_SECRET : (process.env.RENDER ? '' : localSecret); }
export function accountReady() { return Boolean(secret()); }
export function accountEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}
export function newCode() { return String(randomInt(1000000)).padStart(6, '0'); }
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
