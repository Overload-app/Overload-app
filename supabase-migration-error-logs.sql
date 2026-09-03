-- Run this once in your Supabase project's SQL Editor (Supabase dashboard -> SQL Editor -> New query).
--
-- Lightweight client-side error logging — every bug fixed this session was
-- found because a tester happened to notice, catch, and describe it. This
-- catches real errors automatically instead of relying on that every time:
-- a React render crash (via the new ErrorBoundary) or an uncaught JS error
-- anywhere else in the app gets written here, so problems can be spotted
-- and fixed before enough people notice to report them.
--
-- Insert-only from the client: authenticated users can log their own
-- errors, but nobody (not even the account owner) can read, edit, or
-- delete rows via the app — only from the Supabase dashboard itself
-- (Table Editor, or SQL Editor: select * from error_logs order by
-- created_at desc limit 50), or with the service-role key server-side.
create table public.error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  message text,
  stack text,
  context jsonb,
  path text,
  created_at timestamptz default now()
);

alter table public.error_logs enable row level security;

create policy "Authenticated users can log their own errors"
  on public.error_logs for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Deliberately no select/update/delete policy for anon/authenticated —
-- logs are write-only from the app, readable only via the dashboard.
