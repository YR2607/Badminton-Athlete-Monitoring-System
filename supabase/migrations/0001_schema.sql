-- RallyMonitor: initial schema
-- Roles, athletes, groups, check-ins, sessions, readiness, alerts, notes, consent, audit.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type public.app_role as enum ('athlete', 'coach', 'admin');
create type public.athlete_status as enum ('active', 'inactive', 'archived');
create type public.pain_status as enum ('none', 'muscle_soreness', 'joint_tendon', 'acute_instability', 'other');
create type public.pain_side as enum ('left', 'right', 'both', 'na');
create type public.training_type as enum ('court', 'technique', 'game', 'physical', 'strength', 'recovery', 'mixed');
create type public.alert_severity as enum ('normal', 'attention', 'review_load', 'priority');
create type public.alert_status as enum ('open', 'acknowledged', 'resolved', 'dismissed');
create type public.consent_status as enum ('pending', 'granted', 'revoked');
create type public.confidence_level as enum ('sufficient', 'insufficient');
create type public.note_kind as enum ('note', 'decision');

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  role public.app_role not null default 'athlete',
  preferred_language text not null default 'ru' check (preferred_language in ('ru', 'ro', 'en')),
  timezone text not null default 'Europe/Chisinau',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_user_id_idx on public.profiles (user_id);

-- ---------- athletes ----------
create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  athlete_code text not null unique check (char_length(athlete_code) between 2 and 32),
  -- Data minimisation: only birth year is stored, not the full birth date.
  birth_year smallint check (birth_year between 1990 and extract(year from now())::int),
  status public.athlete_status not null default 'active',
  created_at timestamptz not null default now()
);
create index athletes_profile_id_idx on public.athletes (profile_id);

-- ---------- groups ----------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 120),
  description text,
  created_at timestamptz not null default now()
);

create table public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
-- one active membership per athlete per group
create unique index group_memberships_active_uidx
  on public.group_memberships (group_id, athlete_id) where left_at is null;
create index group_memberships_athlete_idx on public.group_memberships (athlete_id);
create index group_memberships_group_idx on public.group_memberships (group_id);

-- ---------- coach assignments ----------
create table public.coach_assignments (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  athlete_id uuid references public.athletes (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(group_id, athlete_id) = 1)
);
create unique index coach_assignments_group_uidx
  on public.coach_assignments (coach_profile_id, group_id) where group_id is not null;
create unique index coach_assignments_athlete_uidx
  on public.coach_assignments (coach_profile_id, athlete_id) where athlete_id is not null;
create index coach_assignments_coach_idx on public.coach_assignments (coach_profile_id);

-- ---------- weekly training schedule (for missed-checkin + reminders) ----------
create table public.training_schedules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  training_type public.training_type not null default 'mixed',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (group_id, weekday, start_time)
);
create index training_schedules_group_idx on public.training_schedules (group_id);

-- ---------- morning check-ins ----------
create table public.morning_checkins (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  -- calendar date in the athlete's timezone; prevents one-day duplicates
  checkin_date date not null,
  submitted_at timestamptz not null default now(),
  sleep_score smallint not null check (sleep_score between 1 and 5),
  recovery_score smallint not null check (recovery_score between 1 and 5),
  fatigue_score smallint not null check (fatigue_score between 1 and 5),
  muscle_soreness_score smallint not null check (muscle_soreness_score between 1 and 5),
  stress_score smallint not null check (stress_score between 1 and 5),
  mood_score smallint not null check (mood_score between 1 and 5),
  pain_status public.pain_status not null default 'none',
  pain_location text,
  pain_side public.pain_side,
  pain_severity smallint check (pain_severity between 1 and 10),
  pain_onset text,
  pain_triggers text[] default '{}', -- walking | jumping | lunges | rest
  swelling boolean,
  movement_limitation boolean,
  symptoms text,
  notes text,
  -- idempotency key generated client-side; protects against double-submit retries
  client_uuid uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, checkin_date),
  unique (athlete_id, client_uuid)
);
create index morning_checkins_athlete_date_idx on public.morning_checkins (athlete_id, checkin_date desc);

-- ---------- training sessions ----------
create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  started_at timestamptz not null,
  duration_minutes smallint not null check (duration_minutes between 1 and 600),
  training_type public.training_type not null,
  session_rpe smallint not null check (session_rpe between 0 and 10),
  -- session_load = duration_minutes * session_rpe, verified by the database itself
  session_load integer generated always as (duration_minutes * session_rpe) stored,
  client_uuid uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (athlete_id, client_uuid)
);
create index training_sessions_athlete_started_idx on public.training_sessions (athlete_id, started_at desc);
create index training_sessions_group_idx on public.training_sessions (group_id);

-- ---------- post-training check-ins ----------
create table public.post_training_checkins (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.training_sessions (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  overall_feeling smallint not null check (overall_feeling between 1 and 5),
  leg_fatigue smallint not null check (leg_fatigue between 1 and 5),
  arm_shoulder_fatigue smallint not null check (arm_shoulder_fatigue between 1 and 5),
  pain_status public.pain_status not null default 'none',
  pain_location text,
  pain_side public.pain_side,
  pain_triggers text[] default '{}',
  notes text,
  client_uuid uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (training_session_id),
  unique (athlete_id, client_uuid)
);
create index post_training_checkins_athlete_idx on public.post_training_checkins (athlete_id, submitted_at desc);

-- ---------- readiness snapshots ----------
create table public.readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  snapshot_date date not null,
  calculated_at timestamptz not null default now(),
  readiness_score numeric(5,2) not null check (readiness_score between 0 and 100),
  normalized_scores jsonb not null, -- {sleep:0-1, recovery:0-1, ...}
  baseline_avg numeric(5,2),
  baseline_sd numeric(5,2),
  baseline_version integer not null default 1,
  input_data_count integer not null default 0,
  confidence public.confidence_level not null default 'insufficient',
  explanation jsonb not null default '{}',
  unique (athlete_id, snapshot_date)
);
create index readiness_snapshots_athlete_date_idx on public.readiness_snapshots (athlete_id, snapshot_date desc);

-- ---------- alert rules (configurable, versioned) ----------
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  severity public.alert_severity not null,
  enabled boolean not null default true,
  params jsonb not null default '{}',
  description text not null default '',
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------- alerts ----------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  rule_code text not null,
  severity public.alert_severity not null,
  triggered_at timestamptz not null default now(),
  status public.alert_status not null default 'open',
  evidence jsonb not null default '{}',
  recommendation text not null default '',
  -- prevents duplicate alerts for the same signal on the same day
  dedup_key text not null unique,
  source_checkin_id uuid,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
create index alerts_athlete_status_idx on public.alerts (athlete_id, status);
create index alerts_triggered_idx on public.alerts (triggered_at desc);
create index alerts_status_idx on public.alerts (status) where status = 'open';

-- ---------- coach notes / decisions ----------
create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  coach_profile_id uuid not null references public.profiles (id) on delete cascade,
  kind public.note_kind not null default 'note',
  note text not null check (char_length(note) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_notes_athlete_idx on public.coach_notes (athlete_id, created_at desc);

-- ---------- consent records ----------
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  consent_type text not null,
  status public.consent_status not null default 'pending',
  recorded_by uuid references public.profiles (id),
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index consent_records_athlete_idx on public.consent_records (athlete_id);

-- ---------- internal notifications ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}',
  read_at timestamptz,
  dedup_key text not null unique,
  created_at timestamptz not null default now()
);
create index notifications_profile_unread_idx on public.notifications (profile_id) where read_at is null;

-- ---------- audit log ----------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_profile_id);

-- ---------- updated_at trigger ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger morning_checkins_touch before update on public.morning_checkins
  for each row execute function public.touch_updated_at();
create trigger coach_notes_touch before update on public.coach_notes
  for each row execute function public.touch_updated_at();
