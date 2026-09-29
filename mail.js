import { isDayGame } from './game.js';
import { issueTurnLink } from './account.js';
import { signInHtml, turnHtml } from './email-template.js';

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
async function sendEmail(to, subject, text, replyTo, html, idempotencyKey) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
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
    `Your Square Game sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not request it, you can ignore this email.`, undefined, signInHtml(code));
}
export async function notifyNextPlayer(game, { reminder = false, idempotencyKey } = {}) {
  if (!isDayGame(game) || game.status !== 'playing') return false;
  const player = game.players[game.current];
  if (!player.email || !mailReady()) return false;
  if (reminder && (!Number.isFinite(game.deadline) || game.deadline <= Date.now() || game.deadline - Date.now() > 2 * 3600000)) return false;
  const credential = issueTurnLink(game, player);
  const link = roomLink(game, credential ? undefined : player.token);
  if (credential) link.hash = new URLSearchParams({ signin: credential }).toString();
  const opponent = game.lastMove?.playerName ?? 'Your opponent';
  const deadline = new Date(game.deadline).toLocaleString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' UTC';
  await sendEmail(player.email, `${reminder ? 'Your turn ends soon' : 'Your turn'} in Square Game — ${game.id}`,
    `${reminder ? 'You have 2 hours or less left to play your turn. Make your move before the clock runs out.' : `${opponent} has moved. It is your turn.`}\n\nRejoin: ${link}\n\nTurn deadline: ${deadline}${credential ? '\n\nThis personal link signs you in. It expires at the turn deadline or after 7 days, whichever comes first. Keep it private.' : ''}`,
    undefined, turnHtml({ opponent, room: game.id, deadline, link, autoSignIn: Boolean(credential), reminder }), idempotencyKey);
  return true;
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
