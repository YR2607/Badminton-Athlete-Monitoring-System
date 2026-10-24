-- 0019: OSTRC-O2 weekly health questionnaire (Phase 3, flag 'ostrc').
-- Scoring follows Clarsen et al., BJSM 2020 — computed server-side in the
-- submit action, never trusted from the client.

create table public.ostrc_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name jsonb not null,              -- {ru, en, ro}
  hint jsonb not null default '{}'::jsonb,  -- "what counts as a problem" per lang
  sort_order int not null default 100,
  active boolean not null default true
);

insert into public.ostrc_zones (code, name, hint, sort_order) values
  (
    'shoulder',
    '{"ru":"Плечо (рука с ракеткой)","en":"Shoulder (racket arm)","ro":"Umăr (mâna rachetei)"}',
    '{"ru":"боль, ноющая боль, скованность, щелчки, отёк или другие жалобы","en":"pain, aching, stiffness, clicking, swelling or other complaints","ro":"durere, durere surdă, rigiditate, trosnituri, umflătură sau alte plângeri"}',
    10
  ),
  (
    'lower_back',
    '{"ru":"Поясница","en":"Lower back","ro":"Zona lombară"}',
    '{"ru":"боль, ноющая боль, скованность или другие жалобы","en":"pain, aching, stiffness or other complaints","ro":"durere, durere surdă, rigiditate sau alte plângeri"}',
    20
  ),
  (
    'knee',
    '{"ru":"Колено","en":"Knee","ro":"Genunchi"}',
    '{"ru":"боль, скованность, щелчки, отёк, чувство нестабильности или другие жалобы","en":"pain, stiffness, clicking, swelling, instability or other complaints","ro":"durere, rigiditate, trosnituri, umflătură, instabilitate sau alte plângeri"}',
    30
  ),
  (
    'ankle_achilles',
    '{"ru":"Голеностоп / ахилл","en":"Ankle / Achilles","ro":"Gleznă / tendonul lui Ahile"}',
    '{"ru":"боль, скованность, отёк, «подворачивание» или другие жалобы","en":"pain, stiffness, swelling, giving way or other complaints","ro":"durere, rigiditate, umflătură, «se succește» sau alte plângeri"}',
    40
  );

alter table public.ostrc_zones enable row level security;
create policy ostrc_zones_select on public.ostrc_zones for select using (true);
create policy ostrc_zones_write on public.ostrc_zones for all using (public.is_admin());

create table public.ostrc_responses (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  week_start_date date not null,          -- ISO week Monday (athlete-local)
  zone_code text not null,
  q1 smallint not null check (q1 in (0, 8, 17, 25)),   -- A/B/C/D participation
  q2 smallint check (q2 in (0, 8, 17, 25)),            -- null when gatekeeper skips
  q3 smallint check (q3 in (0, 8, 17, 25)),
  q4 smallint check (q4 in (0, 8, 17, 25)),
  severity smallint not null check (severity between 0 and 100),
  substantial boolean not null,
  any_problem boolean not null,
  onset_date date,
  days_missed smallint check (days_missed between 0 and 7),
  informed text[] not null default '{}',
  other_reason boolean not null default false,  -- absent for non-zone reasons
  comment text check (char_length(comment) <= 2000),
  questionnaire_version text not null default 'OSTRC-O2',
  locale text,
  submitted_at timestamptz not null default now(),
  unique (athlete_id, week_start_date, zone_code)
);

create index ostrc_resp_athlete_idx on public.ostrc_responses (athlete_id, week_start_date);

alter table public.ostrc_responses enable row level security;
create policy ostrc_select on public.ostrc_responses
  for select using (
    athlete_id = public.current_athlete_id()
    or public.can_access_athlete(athlete_id)
    or public.is_admin()
  );
create policy ostrc_insert on public.ostrc_responses
  for insert with check (athlete_id = public.current_athlete_id());
create policy ostrc_update on public.ostrc_responses
  for update using (athlete_id = public.current_athlete_id())
  with check (athlete_id = public.current_athlete_id());
create policy ostrc_delete on public.ostrc_responses
  for delete using (athlete_id = public.current_athlete_id());

-- Alert rules (thresholds tunable in /admin/rules):
--  * ostrc_substantial — any substantial problem this week (priority)
--  * ostrc_growing     — severity rising 2 consecutive weeks in one zone
--  * ostrc_chronic     — any problem in the same zone >= N weeks in a row
insert into public.alert_rules (code, severity, enabled, params) values
  ('ostrc_substantial', 'priority', true, '{}'),
  ('ostrc_growing', 'review_load', true, '{}'),
  ('ostrc_chronic', 'review_load', true, '{"weeks": 3}')
on conflict (code) do nothing;
