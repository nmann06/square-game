import { isDayGame } from './game.js';

export function mailReady() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.BASE_URL);
}
export async function notifyNextPlayer(game) {
  if (!isDayGame(game) || game.status !== 'playing') return;
  const player = game.players[game.current];
  if (!player.email || !mailReady()) return;
  const link = new URL(`/room/${game.id}`, process.env.BASE_URL);
  link.searchParams.set('token', player.token);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [player.email],
      subject: `Your turn in Square Game — ${game.id}`,
      text: `${game.lastMove?.playerName ?? 'Your opponent'} has moved. It is your turn.\n\nRejoin: ${link}\n\nTurn deadline: ${new Date(game.deadline).toLocaleString('en-US', { timeZone: 'UTC' })} UTC`
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Email delivery failed (${response.status}): ${await response.text()}`);
}
