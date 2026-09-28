# Square Game

A two-player, room-based browser card game based on the [Iota rules](https://www.ultraboardgames.com/iota/game-rules.php), with custom wild-card exchange scoring. Each player gets four cards. Place one to four cards in a single row or column, keeping each line to at most four cards. Within a line, color, shape, and number must each be either all the same or all different.

## Custom wild exchange

Before playing cards, select a regular card from your hand and click a wild card already on the board. If the replacement is legal, you score every line containing the replacement as though you placed it. The wild card goes into your hand for the rest of your turn. All four-card lots involved in the exchange contribute a doubling multiplier to the **combined** exchange and main-move score. For example, two lots at exchange plus one lot when playing cards means `(exchange line points + play line points) × 2 × 2 × 2`.

Wild cards have a face value of zero. The server gives each wild one consistent identity across all of its lines after every move and may reinterpret it on later turns if needed. The game also doubles the turn score when all four cards are played and doubles the final move when a player empties their hand after the deck is depleted.

## Server-side validation

The browser submits only a proposed move, pass, or wild exchange. The server holds the deck, hands, board, turn deadline, and scores. Every action requires that player's private token or a verified account session. The server checks turn ownership, card ownership, placement coordinates, row/column and connection rules, wild consistency, trade limits, and all affected lines before it changes room state. It calculates scores itself and rejects fabricated cards or client-supplied score changes. Supabase writes include an expected room version, so two competing requests cannot both commit against the same state. The browser only receives its own hand; no player email or token is included in public room state.

## Run locally

Requires Node.js 20 or newer. No npm packages are required.

```bash
npm start
```

Open `http://localhost:10000/square-game`. Two browser profiles can create and join a room. Local development writes room state to `data/rooms.json` (ignored by Git); this storage is only for development and cannot survive a Render free-service restart.

```bash
npm test
```

## Deploy on Render

1. Create a Supabase project. Run [`schema.sql`](schema.sql) in its SQL editor. Get the project URL and a **secret** API key. The secret key must never go in browser code or Git.
2. Create a Resend API key and verify a sender domain or sender address. Email uses Resend's HTTPS API because Render's free web services block outbound SMTP ports 25, 465, and 587.
3. Create a Render Blueprint from [`render.yaml`](render.yaml). It creates a Node web service. Keep its assigned `onrender.com` URL for the static homepage's API configuration.
4. Set these environment variables in Render:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Your Supabase project URL |
   | `SUPABASE_SECRET_KEY` | Your server-only secret key |
   | `RESEND_API_KEY` | Your Resend API key |
   | `EMAIL_FROM` | A verified sender, such as `Square Game <games@example.com>` |
   | `ACCOUNT_SECRET` | A random, private secret of at least 32 bytes for signing account sessions |
   | `BASE_URL` | `https://nathanielmann.ca/square-game` (configured in `render.yaml`) |

5. If the game was already deployed, rerun the updated [`schema.sql`](schema.sql) in the Supabase SQL editor to add the login challenge table and verification function. Open `/square-game/health` on the game service to check that `durableStorage`, `emailConfigured`, and `accountConfigured` are all `true`. Then test sign-in and a 1-day room with two email addresses through the public domain.

The existing `nathanielmann.ca` homepage remains a Render static site. It hosts a copy of the game's browser files under `/square-game` and calls this service's API from the browser. Set the homepage's `GAME_API_ORIGIN` environment variable to this service's `onrender.com` origin and redeploy the homepage. This service does not claim the root domain.

The default turn timer is 2 minutes. The host chooses a 1–10 minute timer or a 1, 2, 3, or 7 day timer. Day rooms require both players to sign in, persistent storage, and email configuration. Turn notifications use the verified account email. After a completed move, the next player receives an email with a personal rejoin link. Treat that link as a password: anyone holding it can play as that player in minute-length games. Day-length games also require the matching signed-in account. The general invite link has no player token and is safe to share with the intended opponent.

Accounts use a six-digit email code that expires after ten minutes and can be used once. The browser keeps a 30-day signed account token in local storage. Verified accounts are attached to rooms created or joined while signed in; a typed email alone never attaches a room. Existing rooms in the same browser are linked when their personal room tokens are available. The landing page counts completed games for win rate and games played, and lists waiting or active rooms as current games. Signing out removes the token from that browser. Guest play and personal room links continue to work for minute-length games.

While a room is waiting, the host can email up to three invites from the room page. The invite contains the general room link and code. When anyone joins a room that had an emailed invite, the host gets an email saying the invite was accepted, with their personal rejoin link. Hosts who created the room without an email are asked for one when sending the first invite. Invites work with any timer but need the Resend variables above.

The countdown is enforced when a room is next opened or used. On a free Render service there is no always-on worker, so an expired turn is advanced on the next request rather than exactly at the deadline. Emails are sent when a move is saved; there are no scheduled reminder emails. Render's free service can sleep when idle, so opening an email link can have a cold start.

Either player can request a pause, which takes effect when the opponent accepts. The timer keeps running until acceptance; a turn ending clears an outstanding request. While paused, moves and timeouts stop. Both players must agree to resume, restoring the remaining turn time. The host can delete a waiting room before another player joins.

## Current limits

- Two players per room.
- Email account sign-in requires Resend, Supabase, `ACCOUNT_SECRET`, and the updated schema in production.
- No bot or matchmaking.
- An email delivery failure does not undo a saved move; the UI reports the failure so the player can share the invite manually.
- Storage and email provider accounts must be configured by the site owner before day-length games can be created.

## Files

Completed rooms include a post-game review with per-player averages, highest and lowest scoring turns (including ties), a points-per-turn chart, and a card placement log. Select a turn to inspect its cards and highlight its positions on the final board, or select a final board card to see who placed it. Averages include passes and timeouts; card counts include wild replacements. The opening card is dealt automatically and is not counted for either player.

Turn history is stored in the existing room state and exposed in the public room response only after the game ends. Games created before this feature show an incomplete-history notice; past moves cannot be reconstructed. Deploy the game backend and synchronize the homepage browser assets with `node sync-game.js` from the homepage repository.

- `game.js` — rules, turn progression, and scoring.
- `server.js` — HTTP API and static site.
- `store.js` — local development storage or Supabase REST storage with optimistic version checks.
- `mail.js` — Resend move, invite, and invite-accepted emails.
- `public/` — browser UI.
- `test/` — engine tests.
