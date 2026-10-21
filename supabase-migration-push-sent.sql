-- Run this once in your Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). It remembers which reminders each person has
-- already been sent today, so a reminder can still go out when the hourly
-- check runs late (GitHub often skips or delays it) without ever being sent
-- twice. Until it's run, reminders only go out in their exact hour.

create table if not exists public.push_sent (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, day)
);

-- Only the server reads or writes this.
alter table public.push_sent enable row level security;
