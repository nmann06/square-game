import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const secret = process.env.SUPABASE_SECRET_KEY;
const localPath = resolve('data', 'rooms.json');
const loginPath = resolve('data', 'login-codes.json');

async function localRead(file = localPath) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function localWrite(rooms, file = localPath) {
  await mkdir(resolve('data'), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(rooms));
  await rename(temp, file);
}
async function remote(method, query, body, table = 'square_rooms', prefer = 'return=representation') {
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: secret,
      'content-type': 'application/json',
      prefer
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Room storage failed (${response.status}): ${await response.text()}`);
  return response.status === 204 ? [] : response.json();
}
export async function getLoginChallenge(email) {
  if (durableStorage) {
    const rows = await remote('GET', `?email=eq.${encodeURIComponent(email)}&select=*`, null, 'square_login_codes');
    return rows[0] ?? null;
  }
  return (await localRead(loginPath))[email] ?? null;
}
export async function saveLoginChallenge(email, challenge) {
  if (durableStorage) {
    await remote('POST', '', { email, ...challenge }, 'square_login_codes', 'resolution=merge-duplicates,return=representation');
    return;
  }
  const rows = await localRead(loginPath);
  rows[email] = { email, ...challenge };
  await localWrite(rows, loginPath);
}
export async function updateLoginChallenge(email, previous, changes) {
  if (durableStorage) {
    const query = `?email=eq.${encodeURIComponent(email)}&code_hash=eq.${previous.code_hash}&attempts=eq.${previous.attempts}&select=email`;
    const rows = await remote('PATCH', query, changes, 'square_login_codes');
    return rows.length === 1;
  }
  const rows = await localRead(loginPath);
  if (rows[email]?.code_hash !== previous.code_hash || rows[email]?.attempts !== previous.attempts) return false;
  rows[email] = { ...rows[email], ...changes };
  await localWrite(rows, loginPath);
  return true;
}
export async function verifyLoginChallenge(email, hash, now = Date.now()) {
  if (durableStorage) {
    const response = await fetch(`${url}/rest/v1/rpc/square_verify_login_code`, {
      method: 'POST',
      headers: { apikey: secret, 'content-type': 'application/json' },
      body: JSON.stringify({ p_email: email, p_hash: hash, p_now: new Date(now).toISOString() }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Room storage failed (${response.status}): ${await response.text()}`);
    return response.json();
  }
  const challenge = await getLoginChallenge(email);
  if (!challenge?.code_hash || new Date(challenge.expires_at).getTime() <= now || challenge.attempts >= 5) return false;
  if (challenge.code_hash !== hash) {
    await updateLoginChallenge(email, challenge, { attempts: challenge.attempts + 1 });
    return false;
  }
  return updateLoginChallenge(email, challenge, { code_hash: null, expires_at: null, attempts: 0 });
}
export async function listAccountRooms(email) {
  if (durableStorage) {
    const results = [];
    const contains = encodeURIComponent(JSON.stringify({ players: [{ accountEmail: email }] }));
    for (let offset = 0; ; offset += 500) {
      const rows = await remote('GET', `?select=id,state&state=cs.${contains}&order=updated_at.desc&limit=500&offset=${offset}`);
      results.push(...rows);
      if (rows.length < 500) break;
    }
    return results.map(row => row.state);
  }
  return Object.values(await localRead()).map(row => row.state).filter(game => game.players.some(player => player.accountEmail === email));
}
export const durableStorage = Boolean(url && secret);
export async function listActiveDayRoomIds() {
  if (durableStorage) {
    const ids = [];
    // Keyset pagination remains stable as the worker finishes expired rooms.
    let after = '';
    for (;;) {
      const rows = await remote('GET', `?select=id&state->>status=eq.playing&state->>timerSeconds=in.(86400,172800,259200,604800)&order=id.asc&limit=500${after ? `&id=gt.${encodeURIComponent(after)}` : ''}`);
      ids.push(...rows.map(row => row.id));
      if (rows.length < 500) return ids;
      after = rows.at(-1).id;
    }
  }
  return Object.values(await localRead()).map(row => row.state)
    .filter(game => game.status === 'playing' && game.timerSeconds >= 86400).map(game => game.id);
}
// Returns false if the room id is already taken.
async function createRoomUnlocked(game) {
  if (durableStorage) {
    try { await remote('POST', '', { id: game.id, state: game }); }
    catch (error) { if (/\(409\)/.test(error.message)) return false; throw error; }
    return true;
  }
  const rooms = await localRead();
  if (rooms[game.id]) return false;
  rooms[game.id] = { state: game, version: 0 };
  await localWrite(rooms);
  return true;
}
export async function getRoom(id) {
  if (durableStorage) {
    const rows = await remote('GET', `?id=eq.${encodeURIComponent(id)}&select=state,version`);
    return rows[0] ?? null;
  }
  return (await localRead())[id] ?? null;
}
async function updateRoomUnlocked(id, expectedVersion, state) {
  if (durableStorage) {
    const rows = await remote('PATCH', `?id=eq.${encodeURIComponent(id)}&version=eq.${expectedVersion}&select=id`, {
      state, version: expectedVersion + 1, updated_at: new Date().toISOString()
    });
    return rows.length === 1;
  }
  const rooms = await localRead();
  if (rooms[id]?.version !== expectedVersion) return false;
  rooms[id] = { state, version: expectedVersion + 1 };
  await localWrite(rooms);
  return true;
}
async function deleteRoomUnlocked(id, expectedVersion) {
  if (durableStorage) {
    const rows = await remote('DELETE', `?id=eq.${encodeURIComponent(id)}&version=eq.${expectedVersion}&select=id`);
    return rows.length === 1;
  }
  const rooms = await localRead();
  if (rooms[id]?.version !== expectedVersion) return false;
  delete rooms[id];
  await localWrite(rooms);
  return true;
}

// Keep local read/check/write operations atomic against joins, moves and deletion.
let roomWrites = Promise.resolve();
function roomWrite(operation) {
  if (durableStorage) return operation();
  const result = roomWrites.then(operation);
  roomWrites = result.catch(() => {});
  return result;
}
export function createRoom(game) { return roomWrite(() => createRoomUnlocked(game)); }
export function updateRoom(id, version, state) { return roomWrite(() => updateRoomUnlocked(id, version, state)); }
export function deleteRoom(id, version) { return roomWrite(() => deleteRoomUnlocked(id, version)); }
