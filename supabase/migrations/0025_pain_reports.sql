-- Unified pain reports: one normalized feed from every questionnaire
-- (morning / evening / OSTRC) so zone, side, severity and triggers are
-- comparable over time instead of free-text locations.

create type public.pain_source as enum ('morning', 'evening', 'ostrc');

create table public.pain_reports (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  source public.pain_source not null,
  -- Polymorphic source row: post_training_checkins.id / morning_checkins.id.
  -- No FK on purpose — the source tables have independent lifecycles.
  checkin_id uuid,
  report_date date not null, -- athlete-local date
  zone text not null,        -- canonical zone code (BodyZoneKey / ostrc_zones.code)
  side public.pain_side,
  severity smallint check (severity between 1 and 10),
  triggers text[] not null default '{}',
  onset text,                -- 'new' | 'same' | free text
  notes text,
  created_at timestamptz not null default now()
);
create index pain_reports_athlete_idx on public.pain_reports (athlete_id, report_date desc);
create index pain_reports_zone_idx on public.pain_reports (athlete_id, zone, report_date desc);

alter table public.pain_reports enable row level security;

create policy pain_reports_select on public.pain_reports
  for select using (
    athlete_id = public.current_athlete_id() or public.can_access_athlete(athlete_id)
  );
create policy pain_reports_insert on public.pain_reports
  for insert with check (athlete_id = public.current_athlete_id());
create policy pain_reports_staff_update on public.pain_reports
  for update using (public.is_admin() or public.can_access_athlete(athlete_id))
  with check (public.is_admin() or public.can_access_athlete(athlete_id));
create policy pain_reports_staff_delete on public.pain_reports
  for delete using (public.is_admin() or public.can_access_athlete(athlete_id));

-- Evening check-in gets the same severity/onset fields as the morning one
-- so the detail level matches and existing displays keep working.
alter table public.post_training_checkins
  add column if not exists pain_severity smallint check (pain_severity between 1 and 10),
  add column if not exists pain_onset text;
