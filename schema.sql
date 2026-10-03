create table if not exists public.square_rooms (
  id text primary key,
  state jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Access to this table must stay server-side through the service role key.
revoke all on public.square_rooms from anon, authenticated;
grant select, insert, update on public.square_rooms to service_role;

create index if not exists square_rooms_state_gin on public.square_rooms using gin (state jsonb_path_ops);

create table if not exists public.square_login_codes (
  email text primary key,
  code_hash text,
  expires_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz
);

-- Login challenges are private server-side data.
revoke all on public.square_login_codes from anon, authenticated;
grant select, insert, update on public.square_login_codes to service_role;

create or replace function public.square_verify_login_code(p_email text, p_hash text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare challenge public.square_login_codes%rowtype;
begin
  select * into challenge from public.square_login_codes where email = p_email for update;
  if not found or challenge.code_hash is null or challenge.expires_at <= p_now or challenge.attempts >= 5 then return false; end if;
  if challenge.code_hash <> p_hash then
    update public.square_login_codes set attempts = attempts + 1 where email = p_email;
    return false;
  end if;
  update public.square_login_codes set code_hash = null, expires_at = null, attempts = 0 where email = p_email;
  return true;
end;
$$;

revoke all on function public.square_verify_login_code(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.square_verify_login_code(text, text, timestamptz) to service_role;

create table if not exists public.square_account_profiles (
  email text primary key,
  name text not null check (char_length(name) between 1 and 30),
  color text not null default '#285b36' check (color ~ '^#[0-9a-f]{6}$'),
  updated_at timestamptz not null default now()
);
alter table public.square_account_profiles enable row level security;
revoke all on public.square_account_profiles from anon, authenticated;
grant select, insert, update on public.square_account_profiles to service_role;
