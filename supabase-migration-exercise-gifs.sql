-- Run this once in your Supabase project's SQL Editor (Supabase dashboard -> SQL Editor -> New query).
--
-- A single, GLOBAL, shared cache of WorkoutX exercise-GIF lookups — one row
-- per exercise name, for the whole app, not per user. Without this, the
-- exact same exercise ("Barbell Bench Press") looked up on two different
-- accounts cost two separate WorkoutX requests against the shared 500/mo
-- free-tier quota, even though the answer is identical either way. With
-- this table, whichever account asks first pays the one-time cost; every
-- other account (and every other workout, forever) reads the same row for
-- free.
--
-- Only reachable via the service-role key from api/exercise-gif.js
-- (server-side only, never the browser) — RLS is enabled with no policies
-- granted to the anon/authenticated roles, so it's invisible to any
-- client-side Supabase call, only the server-side admin client can read
-- or write it.
create table public.exercise_gifs (
  name_key text primary key,       -- normalizeGifKey()'d exercise name, e.g. "barbell bench press"
  gif_url text,                    -- the real URL, or null for "confirmed no match in WorkoutX's database"
  checked_at timestamptz default now()
);

alter table public.exercise_gifs enable row level security;
-- Deliberately no policies for anon/authenticated — see comment above.
