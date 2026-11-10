-- AI Coach interpretation layer: analysis runs, generated insights,
-- coach feedback and provider usage accounting. Additive only.
-- All writes come from server code (actions/cron); athletes have no access.

create table if not exists public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  kind text not null,
  subject_type text not null check (subject_type in ('athlete', 'group')),
  subject_id uuid not null,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  model text,
  input_tokens integer,
  output_tokens integer,
  error text,
  created_at timestamptz not null default now(),
  unique (run_date, kind, subject_type, subject_id)
);

create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_analysis_runs (id) on delete set null,
  subject_type text not null check (subject_type in ('athlete', 'group')),
  subject_id uuid not null,
  category text not null,
  severity text not null check (severity in ('info', 'attention', 'important')),
  title text not null,
  insight jsonb,
  insufficient boolean not null default false,
  reason text,
  model_version text,
  prompt_version text,
  generated_at timestamptz not null default now()
);
create index if not exists ai_insights_subject_idx
  on public.ai_insights (subject_type, subject_id, generated_at desc);

create table if not exists public.ai_insight_feedback (
  id uuid primary key default gen_random_uuid(),
  insight_id uuid not null references public.ai_insights (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  comment text,
  created_at timestamptz not null default now(),
  unique (insight_id, profile_id)
);

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_analysis_runs (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  provider text not null default 'openai',
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  endpoint text,
  created_at timestamptz not null default now()
);

alter table public.ai_analysis_runs enable row level security;
alter table public.ai_insights enable row level security;
alter table public.ai_insight_feedback enable row level security;
alter table public.ai_usage_logs enable row level security;

-- Staff-only read: coaches and admins; athletes see nothing.
create policy ai_runs_staff on public.ai_analysis_runs
  for all to authenticated
  using (public.is_admin() or public.current_role() = 'coach')
  with check (public.is_admin() or public.current_role() = 'coach');

create policy ai_insights_staff on public.ai_insights
  for all to authenticated
  using (public.is_admin() or public.current_role() = 'coach')
  with check (public.is_admin() or public.current_role() = 'coach');

-- Feedback: staff write their own rows, read all.
create policy ai_feedback_staff_read on public.ai_insight_feedback
  for select to authenticated
  using (public.is_admin() or public.current_role() = 'coach');
create policy ai_feedback_staff_write on public.ai_insight_feedback
  for insert to authenticated
  with check (
    (public.is_admin() or public.current_role() = 'coach')
    and profile_id = auth.uid()
  );
create policy ai_feedback_staff_update on public.ai_insight_feedback
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy ai_usage_staff on public.ai_usage_logs
  for select to authenticated
  using (public.is_admin() or public.current_role() = 'coach');

-- Feature flag (disabled by default — enable per club when ready).
insert into public.feature_flags (key, description, enabled, group_ids)
values ('ai', 'AI Coach interpretation layer', false, '{}')
on conflict (key) do nothing;
