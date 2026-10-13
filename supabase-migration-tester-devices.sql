-- Run this once in your Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). It records which devices each tester password has
-- been used on, so each password only works on that tester's own device(s).
-- Until it's run, tester passwords still work, just without the device lock.
--
-- To let a tester use a new phone, free their slots with (change the number):
--   delete from public.tester_devices where tester = 3;

create table if not exists public.tester_devices (
  tester int not null,
  device_id text not null,
  claimed_at timestamptz not null default now(),
  primary key (tester, device_id)
);

-- Only the server reads or writes this.
alter table public.tester_devices enable row level security;
