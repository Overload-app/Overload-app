-- Run this once in your Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). Safe to run more than once.
--
-- Makes reminders go out on time. GitHub's "hourly" check was really running
-- about every 5 hours, so reminders were often missed. This has the database
-- itself call the reminder server every 5 minutes instead. No password is
-- stored: each call leaves a random one-time ticket in cron_ticks, which only
-- the server can read and uses up to prove the call came from here.

-- 1. Which reminders each person was already sent today (so nothing is ever
--    sent twice). Same as supabase-migration-push-sent.sql.
create table if not exists public.push_sent (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, day)
);
alter table public.push_sent enable row level security;

-- 2. The one-time tickets. No policies, so only the server can touch them.
create table if not exists public.cron_ticks (
  nonce text primary key,
  created_at timestamptz not null default now()
);
alter table public.cron_ticks enable row level security;

-- 3. The scheduler and the tool it uses to call a web address.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 4. Every 5 minutes: clear old tickets, leave a new one, call the server.
select cron.unschedule('overload-reminders') where exists (select 1 from cron.job where jobname = 'overload-reminders');
select cron.schedule('overload-reminders', '*/5 * * * *', $$
  delete from public.cron_ticks where created_at < now() - interval '1 hour';
  delete from public.push_sent where day < current_date - 3;
  with t as (insert into public.cron_ticks (nonce) values (gen_random_uuid()::text) returning nonce)
  select net.http_post(
    url := 'https://www.overload-app.com/api/push-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Tick', (select nonce from t)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
