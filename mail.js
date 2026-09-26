import { isDayGame } from './game.js';

export function mailReady() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.BASE_URL);
}
function roomLink(game, playerToken) {
  const link = new URL(`room/${game.id}`, process.env.BASE_URL.endsWith('/') ? process.env.BASE_URL : `${process.env.BASE_URL}/`);
  if (playerToken) link.searchParams.set('token', playerToken);
  return link;
}
function timerText(seconds) {
  return seconds < 86400 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}` : `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`;
}
async function sendEmail(to, subject, text, replyTo) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Email delivery failed (${response.status}): ${await response.text()}`);
}
export async function sendFeedback({ name, email, feedback }) {
  await sendEmail('nate@nathanielmann.ca', `Website feedback from ${name}`,
    `Name: ${name}\nEmail: ${email}\n\nFeedback:\n${feedback}`, email);
}
export async function sendSignInCode(email, code) {
  await sendEmail(email, 'Your Square Game sign-in code',
    `Your Square Game sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not request it, you can ignore this email.`);
}
export async function notifyNextPlayer(game) {
  if (!isDayGame(game) || game.status !== 'playing') return;
  const player = game.players[game.current];
  if (!player.email || !mailReady()) return;
  await sendEmail(player.email, `Your turn in Square Game — ${game.id}`,
    `${game.lastMove?.playerName ?? 'Your opponent'} has moved. It is your turn.\n\nRejoin: ${roomLink(game, player.token)}\n\nTurn deadline: ${new Date(game.deadline).toLocaleString('en-US', { timeZone: 'UTC' })} UTC`);
}
export async function sendInvite(game, email) {
  const host = game.players[0];
  await sendEmail(email, `${host.name} invited you to Square Game`,
    `${host.name} invited you to a game of Square Game (${timerText(game.timerSeconds)} per turn).\n\nAccept the invite: ${roomLink(game)}\n\nOr enter room code ${game.id} at ${process.env.BASE_URL}`);
}
export async function notifyInviteAccepted(game) {
  const [host, guest] = game.players;
  if (!host.email || !mailReady()) return;
  const first = game.players[game.current] === host ? 'You go first.' : `${guest.name} goes first.`;
  await sendEmail(host.email, `${guest.name} accepted your Square Game invite`,
    `${guest.name} joined room ${game.id}. The game has started. ${first}\n\nOpen the game: ${roomLink(game, host.token)}`);
}
