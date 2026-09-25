# Square Game

A two-player, room-based browser card game based on the [Iota rules](https://www.ultraboardgames.com/iota/game-rules.php), with custom wild-card exchange scoring. Each player gets four cards. Place one to four cards in a single row or column, keeping each line to at most four cards. Within a line, color, shape, and number must each be either all the same or all different.

## Custom wild exchange

Before playing cards, select a regular card from your hand and click a wild card already on the board. If the replacement is legal, you score every line containing the replacement as though you placed it. The wild card goes into your hand for the rest of your turn. All four-card lots involved in the exchange contribute a doubling multiplier to the **combined** exchange and main-move score. For example, two lots at exchange plus one lot when playing cards means `(exchange line points + play line points) × 2 × 2 × 2`.

Wild cards have a face value of zero. The server gives each wild one consistent identity across all of its lines after every move and may reinterpret it on later turns if needed. The game also doubles the turn score when all four cards are played and doubles the final move when a player empties their hand after the deck is depleted.

## Server-side validation

The browser submits only a proposed move, pass, or wild exchange. The server holds the deck, hands, board, turn deadline, and scores. Every action requires that player's private token. The server checks turn ownership, card ownership, placement coordinates, row/column and connection rules, wild consistency, trade limits, and all affected lines before it changes room state. It calculates scores itself and rejects fabricated cards or client-supplied score changes. Supabase writes include an expected room version, so two competing requests cannot both commit against the same state. The browser only receives its own hand; no player email or token is included in public room state.

## Run locally

Requires Node.js 20 or newer. No npm packages are required.

```bash
npm start
```

Open `http://localhost:10000`. Two browser profiles can create and join a room. Local development writes room state to `data/rooms.json` (ignored by Git); this storage is only for development and cannot survive a Render free-service restart.

```bash
npm test
```

## Deploy on Render

1. Create a Supabase project. Run [`schema.sql`](schema.sql) in its SQL editor. Get the project URL and a **secret** API key. The secret key must never go in browser code or Git.
2. Create a Resend API key and verify a sender domain or sender address. Email uses Resend's HTTPS API because Render's free web services block outbound SMTP ports 25, 465, and 587.
3. Create a Render **Web Service** connected to this repository. Use a Node runtime, build command `npm install`, start command `npm start`, and the Free instance type.
4. Set these environment variables in Render:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Your Supabase project URL |
   | `SUPABASE_SECRET_KEY` | Your server-only secret key |
   | `RESEND_API_KEY` | Your Resend API key |
   | `EMAIL_FROM` | A verified sender, such as `Square Game <games@example.com>` |
   | `BASE_URL` | Your public site URL, such as `https://square-game.onrender.com` |

5. Open `/health` to check that `durableStorage` and `emailConfigured` are both `true`. Then test a 1-day room with two email addresses.

The host chooses a 1–10 minute timer or a 1, 2, 3, or 7 day timer. Day rooms require persistent storage and email configuration. After a completed move, the next player receives an email with a personal rejoin link. Treat that link as a password: anyone holding it can play as that player. The general invite link has no player token and is safe to share with the intended opponent.

The countdown is enforced when a room is next opened or used. On a free Render service there is no always-on worker, so an expired turn is advanced on the next request rather than exactly at the deadline. Emails are sent when a move is saved; there are no scheduled reminder emails. Render's free service can sleep when idle, so opening an email link can have a cold start.

## Current limits

- Two players per room.
- No account system or password recovery. Save your personal link or keep the same browser's local storage.
- No bot or matchmaking.
- An email delivery failure does not undo a saved move; the UI reports the failure so the player can share the invite manually.
- Storage and email provider accounts must be configured by the site owner before day-length games can be created.

## Files

- `game.js` — rules, turn progression, and scoring.
- `server.js` — HTTP API and static site.
- `store.js` — local development storage or Supabase REST storage with optimistic version checks.
- `mail.js` — Resend move notifications.
- `public/` — browser UI.
- `test/` — engine tests.
