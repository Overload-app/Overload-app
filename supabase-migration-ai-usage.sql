-- Run this once in your Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). It adds the server-side AI spending record that
-- caps free-trial accounts at the same limits the app already shows them
-- ($0.15 a day, $0.75 a month). Until this is run, the server simply doesn't
-- enforce the cap — nothing breaks.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  cents numeric not null default 0,
  primary key (user_id, day)
);

-- Only the server (service role) reads or writes this. No policies means no
-- signed-in user can see or change it from the app.
alter table public.ai_usage enable row level security;

-- Adds to today's total in one step, so two requests at once can't lose one.
create or replace function public.add_ai_usage(p_user uuid, p_day date, p_cents numeric)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage (user_id, day, cents)
  values (p_user, p_day, p_cents)
  on conflict (user_id, day) do update set cents = public.ai_usage.cents + excluded.cents;
$$;

revoke all on function public.add_ai_usage(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.add_ai_usage(uuid, date, numeric) to service_role;
