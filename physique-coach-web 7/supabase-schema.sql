-- Run this once in your Supabase project's SQL Editor (Supabase dashboard -> SQL Editor -> New query).

-- One row per user: their name, subscription status, and Stripe customer id.
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text,
  email text,
  subscribed boolean default false,
  trial_started_at timestamptz,
  stripe_customer_id text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- One row per user: their entire app state (program, logs, coach chat) as JSON,
-- same shape the app already uses -- just backed by a real database instead of the browser.
create table public.app_state (
  user_id uuid references auth.users on delete cascade primary key,
  state jsonb,
  updated_at timestamptz default now()
);

alter table public.app_state enable row level security;

create policy "Users can view their own app state"
  on public.app_state for select
  using (auth.uid() = user_id);

create policy "Users can insert their own app state"
  on public.app_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own app state"
  on public.app_state for update
  using (auth.uid() = user_id);

-- Automatically create a profiles row whenever someone signs up.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, new.raw_user_meta_data->>'name', new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
