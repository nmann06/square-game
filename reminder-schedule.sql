-- Optional scheduler for the existing Supabase + free Render setup.
-- No Render cron service is needed. Run schema.sql first.
-- In Render, set REMINDER_SECRET to a random private value of at least 32 characters.
-- In Supabase Vault, create these named secrets before running this script:
--   square_reminder_url: https://YOUR-GAME-SERVICE.onrender.com/square-game/api/reminders/run
--   square_reminder_secret: the exact same REMINDER_SECRET value
-- Do not use the static homepage URL here or commit either secret to Git.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.square_trigger_reminders()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  endpoint text;
  credential text;
  now_ms bigint := floor(extract(epoch from now()) * 1000);
begin
  -- Wake the web service only for due reminders or expired day turns.
  -- Paused/waiting/finished games and minute games never trigger requests.
  if not exists (
    select 1 from public.square_rooms
    where state->>'status' = 'playing'
      and (state->>'timerSeconds')::integer >= 86400
      and (state->>'deadline')::bigint <= now_ms + 7200000
      and (
        (state->>'deadline')::bigint <= now_ms
        or state->'turnReminder'->>'playerId' is distinct from state->'players'->((state->>'current')::integer)->>'id'
        or state->'turnReminder'->>'turnStartedAt' is distinct from coalesce(state->'lastMove'->>'at', state->>'createdAt')
        or coalesce((state->'turnReminder'->>'turnCount')::integer, -1) <> coalesce(jsonb_array_length(state->'turnHistory'), 0)
      )
  ) then return null; end if;

  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'square_reminder_url';
  select decrypted_secret into credential from vault.decrypted_secrets where name = 'square_reminder_secret';
  if endpoint is null or endpoint !~ '^https://' or credential is null or length(credential) < 32 then
    raise exception 'Configure square_reminder_url and square_reminder_secret in Supabase Vault first';
  end if;
  return net.http_post(
    url := endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || credential),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.square_trigger_reminders() from public, anon, authenticated;

-- Re-running this named schedule updates it instead of adding a second job.
select cron.schedule('square-game-reminders', '* * * * *', 'select public.square_trigger_reminders();');

-- Disable later with: select cron.unschedule('square-game-reminders');
-- HTTP delivery results are in net._http_response; cron success alone only
-- means the HTTP request was queued. Failed deliveries retry next minute.
