-- Run in the Supabase SQL editor after 20261003_account_profiles.sql.
-- Adds the language and colourblind tile colours chosen under "Edit account".
-- Safe to rerun; existing profiles keep English and the standard tile colours.
begin;

alter table public.square_account_profiles
  add column if not exists language text not null default 'en',
  add column if not exists tile_colors jsonb;

alter table public.square_account_profiles drop constraint if exists square_account_profiles_language_check;
alter table public.square_account_profiles
  add constraint square_account_profiles_language_check check (language in ('en', 'zh'));

notify pgrst, 'reload schema';
commit;
