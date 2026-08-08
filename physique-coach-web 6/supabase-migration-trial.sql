-- Run this once in your Supabase SQL Editor if you already ran supabase-schema.sql
-- before this file existed. Adds the column needed for the cardless 30-day trial.

alter table public.profiles add column if not exists trial_started_at timestamptz;
