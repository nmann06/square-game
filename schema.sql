create table if not exists public.square_rooms (
  id text primary key,
  state jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Access to this table must stay server-side through the service role key.
revoke all on public.square_rooms from anon, authenticated;
grant select, insert, update on public.square_rooms to service_role;
