-- 0018: Web Push subscriptions (Phase 9, flag 'push'). One row per installed
-- browser/PWA; VAPID keys live in env vars, never in the DB.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

-- A user manages only their own subscriptions.
create policy push_subs_all on public.push_subscriptions
  for all using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());
