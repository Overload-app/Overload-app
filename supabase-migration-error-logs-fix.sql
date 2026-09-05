-- Run this once in your Supabase project's SQL Editor. Fixes a real gap in
-- the original error_logs setup (supabase-migration-error-logs.sql), which
-- already ran successfully — this only replaces its insert policy.
--
-- The original policy required the row's user_id to exactly match the
-- signed-in user: `auth.uid() = user_id`. When user_id is null, that
-- check evaluates to false (not true), so Postgres silently REJECTS the
-- insert — the app's own try/catch swallows the failure, so nothing ever
-- showed up as an error, and error_logs just stayed empty. That's exactly
-- what happened to a crash on cold app open, before the app has finished
-- resolving who's signed in — the one case we most needed to catch.
--
-- This allows a null user_id through (for authenticated users, and for
-- true pre-auth/anon crashes), while still blocking someone from writing
-- a log row and attributing it to a DIFFERENT real user's id.
drop policy if exists "Authenticated users can log their own errors" on public.error_logs;

create policy "Authenticated users can log their own errors"
  on public.error_logs for insert
  to authenticated
  with check (auth.uid() = user_id or user_id is null);

create policy "Unauthenticated crash reports"
  on public.error_logs for insert
  to anon
  with check (user_id is null);

-- Still deliberately no select/update/delete policy for anon/authenticated —
-- logs stay write-only from the app, readable only via the dashboard.
