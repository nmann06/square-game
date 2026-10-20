-- Run in the Supabase SQL editor after 20261016_account_preferences.sql.
-- Adds the "show move dots" toggle under "Edit account". Wild tile colours live in tile_colors.
-- Safe to rerun; existing profiles keep move dots switched on.
begin;

alter table public.square_account_profiles
  add column if not exists move_dots boolean not null default true;

notify pgrst, 'reload schema';
commit;
