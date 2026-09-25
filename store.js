import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const secret = process.env.SUPABASE_SECRET_KEY;
const localPath = resolve('data', 'rooms.json');

async function localRead() {
  try { return JSON.parse(await readFile(localPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function localWrite(rooms) {
  await mkdir(resolve('data'), { recursive: true });
  const temp = `${localPath}.tmp`;
  await writeFile(temp, JSON.stringify(rooms));
  await rename(temp, localPath);
}
async function remote(method, query, body) {
  const response = await fetch(`${url}/rest/v1/square_rooms${query}`, {
    method,
    headers: {
      apikey: secret,
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Room storage failed (${response.status}): ${await response.text()}`);
  return response.status === 204 ? [] : response.json();
}
export const durableStorage = Boolean(url && secret);
// Returns false if the room id is already taken.
export async function createRoom(game) {
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
export async function updateRoom(id, expectedVersion, state) {
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
