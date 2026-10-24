-- 0015: growth & biological maturation (Phase 4, flag 'growth').
-- Adds birth_date/sex/parent heights to athletes (recorded by coach/admin,
-- parent heights only with parental consent) and a monthly measurement log.
-- NOTE: athletes previously stored only birth_year for data minimisation —
-- birth_date is now needed for decimal age in the Khamis-Roche model.

alter table public.athletes
  add column birth_date date,
  add column sex text check (sex in ('male', 'female')),
  add column mother_height_cm numeric(4,1) check (mother_height_cm between 100 and 220),
  add column father_height_cm numeric(4,1) check (father_height_cm between 100 and 220);

create table public.growth_measurements (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  measured_on date not null,
  height_cm numeric(5,1) not null check (height_cm between 50 and 230),
  weight_kg numeric(5,1) check (weight_kg between 10 and 200),
  sitting_height_cm numeric(5,1) check (sitting_height_cm between 20 and 120), -- optional, for Mirwald later
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (athlete_id, measured_on)
);

create index growth_measurements_athlete_idx
  on public.growth_measurements (athlete_id, measured_on desc);

alter table public.growth_measurements enable row level security;

-- Athlete sees own measurements; coach/admin via group access.
create policy growth_select on public.growth_measurements
  for select using (
    athlete_id = public.current_athlete_id() or public.can_access_athlete(athlete_id)
  );

-- Only staff enter measurements (on behalf of the athlete).
create policy growth_insert on public.growth_measurements
  for insert with check (public.is_admin() or public.can_access_athlete(athlete_id));

create policy growth_update on public.growth_measurements
  for update using (public.is_admin() or public.can_access_athlete(athlete_id))
  with check (public.is_admin() or public.can_access_athlete(athlete_id));

create policy growth_delete on public.growth_measurements
  for delete using (public.is_admin() or public.can_access_athlete(athlete_id));

-- Alert: entered the growth-spurt %PAH band or velocity above threshold.
insert into public.alert_rules (code, severity, enabled, params, description) values
  ('growth_spurt', 'review_load', true,
   '{"band_low": 88, "band_high": 95, "velocity_cm_yr": 9}'::jsonb,
   'Athlete entered the 88–95% PAH growth-spurt band or growth velocity exceeded the threshold — reduce jump volume, watch landing technique.')
on conflict (code) do nothing;
