-- 0010: feature flags — new modules ship behind admin-controlled switches.
-- Semantics: enabled=false -> off for everyone; enabled=true + empty group_ids
-- -> on for everyone; enabled=true + group_ids -> on only for athletes whose
-- current group membership is listed (coaches/admins see it in context of
-- those athletes).

create table public.feature_flags (
  key text primary key,
  description text not null default '',
  enabled boolean not null default false,
  group_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

create policy "flags_select" on public.feature_flags
  for select using (auth.uid() is not null);

create policy "flags_admin_write" on public.feature_flags
  for all using (is_admin()) with check (is_admin());

-- Single flag check for an athlete context. NULL athlete = "does anyone have it".
create or replace function public.feature_flag_enabled(flag_key text, p_athlete_id uuid default null)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select
      case
        when not f.enabled then false
        when f.group_ids = '{}' then true
        when p_athlete_id is null then true
        else exists (
          select 1 from group_memberships gm
          where gm.athlete_id = p_athlete_id
            and gm.left_at is null
            and gm.group_id = any(f.group_ids)
        )
      end
    from feature_flags f
    where f.key = flag_key
  ), false);
$$;

insert into public.feature_flags (key, description) values
  ('srpe', 'Session load: RPE x minutes in the evening check-in, EWMA-ACWR, monotony'),
  ('zscore_baseline', 'Personal z-score norms per questionnaire item (28-day window)'),
  ('athlete_dashboard', 'Analytical athlete dashboard for coaches'),
  ('ostrc', 'Weekly OSTRC-O2 overuse questionnaire'),
  ('recommendations', 'Recommendation rules engine for coaches'),
  ('growth', 'Growth & maturation tracking (height, velocity, %PAH)'),
  ('events', 'Group/athlete event calendar (tournaments, exams, illness)'),
  ('field_tests', 'Monthly field test results'),
  ('push', 'Web push reminders for the installed PWA');
