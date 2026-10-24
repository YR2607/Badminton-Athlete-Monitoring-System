-- 0020: per-date session plan overrides.
-- The weekly training_schedules template defines the default plan; this table
-- lets a coach adjust a specific date (different minutes/RPE) or cancel /
-- add a session without editing the template.

create table public.session_plan_overrides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  plan_date date not null,
  cancelled boolean not null default false, -- true = no training that day
  start_time time,          -- session start for added days (drives reminders)
  planned_minutes smallint,
  planned_rpe smallint,
  created_at timestamptz not null default now(),
  unique (group_id, plan_date),
  constraint overrides_planned_minutes_check check (planned_minutes between 1 and 600),
  constraint overrides_planned_rpe_check check (planned_rpe between 0 and 10)
);
create index session_plan_overrides_group_idx on public.session_plan_overrides (group_id, plan_date);

alter table public.session_plan_overrides enable row level security;

create policy plan_overrides_select on public.session_plan_overrides
  for select using (public.can_access_group(group_id));
create policy plan_overrides_write on public.session_plan_overrides
  for all using (public.is_coach())
  with check (public.is_coach());
