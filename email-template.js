export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function frame(preheader, eyebrow, title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Square Game</title></head>
<body style="margin:0;padding:0;background:#14271f;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#14271f"><tr><td style="padding:28px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:auto;">
<tr><td style="padding:0 0 24px;color:#eaf1e5;font-size:22px;font-weight:bold;"><span aria-hidden="true" style="display:inline-block;background:#dcf36b;color:#173021;border-radius:7px;padding:3px 9px;margin-right:9px;">▦</span> Square Game</td></tr>
<tr><td bgcolor="#f3f2e9" style="background:#f3f2e9;border-radius:14px;padding:32px 24px;color:#183125;">
<p style="font-size:11px;letter-spacing:2px;font-weight:bold;color:#52683d;margin:0 0 16px;">${escapeHtml(eyebrow)}</p>
<h1 style="font-size:30px;line-height:1.15;letter-spacing:-1px;margin:0 0 16px;">${escapeHtml(title)}</h1>${content}
</td></tr><tr><td style="padding:23px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:#a8bba8;">Square Game</td></tr>
</table></td></tr></table></body></html>`;
}
export function signInHtml(code) {
  return frame('Your Square Game sign-in code expires in 10 minutes.', 'READY TO PLAY?', 'Your sign-in code.', `
<p style="font-size:16px;line-height:1.6;color:#526453;margin:0 0 24px;">Enter this code in Square Game to verify your email and sign in.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td bgcolor="#e4e9d8" style="border:1px solid #ccd6bd;border-radius:9px;padding:22px 10px;text-align:center;font-family:Consolas,'Courier New',monospace;font-size:38px;letter-spacing:6px;font-weight:bold;color:#183125;">${escapeHtml(code)}</td></tr></table>
<p style="font-size:13px;line-height:1.6;text-align:center;color:#607362;margin:14px 0 26px;">This code expires in <strong>10 minutes.</strong></p>
<p style="border-top:1px solid #d5dccd;padding-top:20px;font-size:13px;line-height:1.7;color:#607362;margin:0;">If you didn’t request this code, you can ignore this email.</p>`);
}
export function turnHtml({ opponent, room, deadline, link, autoSignIn, reminder = false }) {
  const url = escapeHtml(link);
  return frame(reminder ? 'Your Square Game turn ends soon. Make your move before the deadline.' : `${opponent} has moved. It’s your turn.`, reminder ? 'TURN REMINDER' : 'THE BOARD IS WAITING', reminder ? 'Time for your move.' : 'Your move.', `
<p style="font-size:16px;line-height:1.6;color:#526453;margin:0 0 24px;">${reminder ? 'You have <strong style="color:#183125;">2 hours or less</strong> left to play your turn. Make your move before the clock runs out.' : `<strong style="color:#183125;">${escapeHtml(opponent)}</strong> has moved. It’s your turn to make the next play.`}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td bgcolor="#e4e9d8" style="border:1px solid #ccd6bd;border-radius:9px;padding:18px 20px;">
<p style="font-size:11px;letter-spacing:1px;color:#607362;margin:0 0 6px;">ROOM <strong style="color:#183125;">${escapeHtml(room)}</strong></p>
<p style="font-size:13px;color:#607362;line-height:1.7;margin:0;">Turn deadline<br><strong style="font-size:16px;color:#183125;">${escapeHtml(deadline)}</strong></p></td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;"><tr><td bgcolor="#dcf36b" style="border-radius:8px;text-align:center;mso-padding-alt:16px 20px;"><a href="${url}" style="display:block;padding:16px 20px;color:#173021;font-size:16px;font-weight:bold;text-decoration:none;">Play your turn &rarr;</a></td></tr></table>
<p style="font-size:12px;line-height:1.7;color:#607362;margin:20px 0 0;">${autoSignIn ? 'This personal link signs you in and opens your game. It expires at the turn deadline or after 7 days, whichever comes first. Keep it private.<br><br>' : ''}Button not working? Copy the link into your browser:<br><a href="${url}" style="color:#607362;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;">${url}</a></p>`);
}
