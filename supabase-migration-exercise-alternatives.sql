-- Run this once in your Supabase project's SQL Editor (Supabase dashboard -> SQL Editor -> New query).
--
-- A single, GLOBAL, shared cache of "similar exercises" AI suggestions —
-- one row per (exercise name, equipment) pair, for the whole app, not per
-- user. Without this, the exact same exercise ("Bench Press", full gym
-- equipment) looked up on two different accounts cost two separate Claude
-- API calls for an answer that's realistically the same either way, since
-- the suggestion is genuinely-similar-exercise matching, not something
-- personalized beyond equipment/injuries. Real ask: "optimize it to save
-- things like alternative workouts across the network... do this in any
-- way possible to save credits on the ai."
--
-- Deliberately keyed WITHOUT injuries, and only ever written/read when the
-- requester has none listed (see api/exercise-alternatives.js) — an
-- injury-aware suggestion is safety-relevant and personal, so caching
-- across different injury profiles risks surfacing a genuinely
-- contraindicated exercise to someone it was never actually checked
-- against. "No injuries" is comfortably the common case, so this still
-- covers most real requests.
--
-- Only reachable via the service-role key from
-- api/exercise-alternatives.js (server-side only, never the browser) —
-- RLS is enabled with no policies granted to the anon/authenticated
-- roles, so it's invisible to any client-side Supabase call, only the
-- server-side admin client can read or write it.
create table public.exercise_alternatives (
  cache_key text primary key,      -- "<normalized exercise name>|<equipment>", e.g. "bench press|full"
  alternatives jsonb not null,     -- the 3 suggested exercise names, as a JSON array of strings
  created_at timestamptz default now()
);

alter table public.exercise_alternatives enable row level security;
-- Deliberately no policies for anon/authenticated — see comment above.
