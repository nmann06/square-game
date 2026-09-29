import { createHash } from 'node:crypto';
import { advanceExpired, isDayGame } from './game.js';
import { listActiveDayRoomIds, getRoom, updateRoom } from './store.js';
import { notifyNextPlayer } from './mail.js';

const TWO_HOURS = 2 * 3600000;
export function reminderTurnKey(game) {
  // Pausing/resuming changes the deadline, but does not create another turn.
  return createHash('sha256').update(JSON.stringify([
    game.id, game.createdAt, game.players[game.current]?.id,
    game.turnHistory?.length ?? 0, game.lastMove?.at ?? null
  ])).digest('hex');
}
export function reminderDue(game, now = Date.now()) {
  const player = game.players[game.current];
  return isDayGame(game) && game.status === 'playing' && Number.isFinite(game.deadline)
    && game.deadline > now && game.deadline - now <= TWO_HOURS
    && Boolean(player?.email) && player.email === player.accountEmail
    && game.turnReminder?.turnKey !== reminderTurnKey(game);
}

export async function runReminders({
  list = listActiveDayRoomIds, get = getRoom, update = updateRoom,
  send = notifyNextPlayer, now = Date.now,
  onError = (id, error) => console.error(`Reminder failed for room ${id}:`, error.message)
} = {}) {
  const result = { sent: 0, advanced: 0, failed: 0 };
  for (const id of await list()) {
    try {
      let row;
      for (let attempt = 0; attempt < 5; attempt++) {
        row = await get(id);
        if (!row || !isDayGame(row.state) || row.state.status !== 'playing') break;
        if (row.state.deadline > now()) break;
        const next = advanceExpired(row.state, now());
        if (await update(id, row.version, next)) result.advanced++;
        row = null; // Re-read after advancing or losing a race to a player move.
      }
      if (!row || !reminderDue(row.state, now())) continue;
      const turnKey = reminderTurnKey(row.state);
      const deadline = row.state.deadline;
      // Re-check live state immediately before sending, not the scan's snapshot.
      row = await get(id);
      if (!row || !reminderDue(row.state, now()) || reminderTurnKey(row.state) !== turnKey || row.state.deadline !== deadline) continue;
      const delivered = await send(row.state, { reminder: true, idempotencyKey: `turn-reminder/${turnKey}/${deadline}` });
      if (!delivered) continue;
      result.sent++;
      // Merge only the marker into fresh state; never overwrite a concurrent move.
      for (let attempt = 0; attempt < 5; attempt++) {
        const latest = await get(id);
        if (!latest || reminderTurnKey(latest.state) !== turnKey || latest.state.turnReminder?.turnKey === turnKey) break;
        const next = { ...latest.state, turnReminder: {
          turnKey, sentAt: now(), playerId: latest.state.players[latest.state.current]?.id,
          turnStartedAt: latest.state.lastMove?.at ?? latest.state.createdAt,
          turnCount: latest.state.turnHistory?.length ?? 0
        } };
        if (await update(id, latest.version, next)) break;
        if (attempt === 4) throw new Error('Could not record reminder delivery; the next run will retry with the same idempotency key.');
      }
    } catch (error) { result.failed++; onError(id, error); }
  }
  return result;
}
