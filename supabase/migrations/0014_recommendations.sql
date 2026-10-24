-- 0014: coach-facing recommendations (Phase 8). One row per rule per day,
-- generated server-side by evaluateAthleteDay behind the 'recommendations'
-- flag. Coaches mark each as accepted / modified / rejected — the decision
-- trail is kept for later rule-quality analysis. Athletes do NOT see these:
-- the layer advises the coach, it is not medical info for the child.

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  rec_date date not null,
  rule_key text not null,
  severity text not null default 'info'
    check (severity in ('info', 'reduce', 'talk', 'rest', 'medical')),
  inputs jsonb not null default '{}'::jsonb,
  decision text not null default 'pending'
    check (decision in ('pending', 'accepted', 'modified', 'rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  coach_comment text,
  created_at timestamptz not null default now(),
  unique (athlete_id, rec_date, rule_key)
);

create index recommendations_athlete_date_idx
  on public.recommendations (athlete_id, rec_date desc);

alter table public.recommendations enable row level security;

-- Coach reads/updates only athletes in own groups; admin everything.
-- No athlete-facing access. Inserts happen via the service role.
create policy recommendations_select on public.recommendations
  for select using (public.is_admin() or public.can_access_athlete(athlete_id));

create policy recommendations_update on public.recommendations
  for update using (public.is_admin() or public.can_access_athlete(athlete_id))
  with check (public.is_admin() or public.can_access_athlete(athlete_id));
