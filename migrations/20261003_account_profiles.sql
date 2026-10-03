-- Run in the Supabase SQL editor for the project used by the game backend.
-- Safe to rerun; existing account profiles are preserved.
begin;

create table if not exists public.square_account_profiles (
  email text primary key,
  name text not null check (char_length(name) between 1 and 30),
  color text not null default '#285b36' check (color ~ '^#[0-9a-f]{6}$'),
  updated_at timestamptz not null default now()
);

alter table public.square_account_profiles enable row level security;
revoke all on public.square_account_profiles from anon, authenticated;
grant select, insert, update on public.square_account_profiles to service_role;

notify pgrst, 'reload schema';
commit;
