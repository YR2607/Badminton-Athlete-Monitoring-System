-- RallyMonitor: row-level security + security-definer helpers

-- ---------- helpers ----------
-- Profile row of the currently authenticated user.
create or replace function public.current_profile_id()
returns uuid language sql stable security definer
set search_path = public as $$
  select id from public.profiles where user_id = auth.uid() limit 1
$$;

create or replace function public.current_role()
returns public.app_role language sql stable security definer
set search_path = public as $$
  select role from public.profiles where user_id = auth.uid() limit 1
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_coach()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role in ('coach','admin'))
$$;

-- Athlete id of the current user (null for non-athletes).
create or replace function public.current_athlete_id()
returns uuid language sql stable security definer
set search_path = public as $$
  select a.id from public.athletes a
  join public.profiles p on p.id = a.profile_id
  where p.user_id = auth.uid() limit 1
$$;

-- True when the current user is a coach assigned to this athlete
-- (directly, or via a group the athlete belongs to). Admins count as coaches.
create or replace function public.can_access_athlete(p_athlete_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.coach_assignments ca
      where ca.coach_profile_id = public.current_profile_id()
        and ca.athlete_id = p_athlete_id
    )
    or exists (
      select 1 from public.coach_assignments ca
      join public.group_memberships gm
        on gm.group_id = ca.group_id and gm.left_at is null
      where ca.coach_profile_id = public.current_profile_id()
        and gm.athlete_id = p_athlete_id
    )
$$;

-- True when the current user is a coach assigned to the group (or admin).
create or replace function public.can_access_group(p_group_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.coach_assignments ca
      where ca.coach_profile_id = public.current_profile_id()
        and ca.group_id = p_group_id
    )
    or exists (
      select 1 from public.group_memberships gm
      join public.athletes a on a.id = gm.athlete_id
      join public.profiles p on p.id = a.profile_id
      where gm.group_id = p_group_id and gm.left_at is null
        and p.user_id = auth.uid()
    )
$$;

-- Prevent privilege escalation: non-admins cannot change their own role.
create or replace function public.prevent_role_self_escalation()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role can only be changed by an admin';
  end if;
  return new;
end $$;
create trigger profiles_no_self_escalation before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();

-- RPC used by the server-side rules engine to persist alerts with dedup.
-- Caller must be the athlete themself, an assigned coach, or an admin.
create or replace function public.record_alert(
  p_athlete_id uuid,
  p_rule_code text,
  p_severity public.alert_severity,
  p_evidence jsonb,
  p_recommendation text,
  p_dedup_key text,
  p_source_checkin_id uuid default null
) returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_id uuid;
begin
  -- service_role (server engine) may always write; authenticated callers must
  -- be the athlete themself, an assigned coach, or an admin.
  if auth.role() <> 'service_role'
     and not (p_athlete_id = public.current_athlete_id() or public.can_access_athlete(p_athlete_id)) then
    raise exception 'not allowed to record alerts for this athlete';
  end if;
  insert into public.alerts (
    athlete_id, rule_code, severity, evidence, recommendation, dedup_key, source_checkin_id
  ) values (
    p_athlete_id, p_rule_code, p_severity, p_evidence, p_recommendation, p_dedup_key, p_source_checkin_id
  )
  on conflict (dedup_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ---------- enable RLS ----------
alter table public.profiles enable row level security;
alter table public.athletes enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.coach_assignments enable row level security;
alter table public.training_schedules enable row level security;
alter table public.morning_checkins enable row level security;
alter table public.training_sessions enable row level security;
alter table public.post_training_checkins enable row level security;
alter table public.readiness_snapshots enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alerts enable row level security;
alter table public.coach_notes enable row level security;
alter table public.consent_records enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- ---------- profiles ----------
create policy profiles_select_self on public.profiles
  for select using (user_id = auth.uid() or public.is_admin());
create policy profiles_select_coach on public.profiles
  for select using (
    public.is_coach() and exists (
      select 1 from public.athletes a
      where a.profile_id = profiles.id and public.can_access_athlete(a.id)
    )
  );
create policy profiles_insert_self on public.profiles
  for insert with check (user_id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ---------- athletes ----------
create policy athletes_select on public.athletes
  for select using (
    profile_id = public.current_profile_id()
    or public.can_access_athlete(id)
  );
create policy athletes_admin_write on public.athletes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- groups ----------
create policy groups_select on public.groups
  for select using (public.can_access_group(id));
create policy groups_admin_write on public.groups
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- group_memberships ----------
create policy memberships_select on public.group_memberships
  for select using (
    athlete_id = public.current_athlete_id()
    or public.can_access_group(group_id)
  );
create policy memberships_admin_write on public.group_memberships
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- coach_assignments ----------
create policy assignments_select on public.coach_assignments
  for select using (coach_profile_id = public.current_profile_id() or public.is_admin());
create policy assignments_admin_write on public.coach_assignments
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- training_schedules ----------
create policy schedules_select on public.training_schedules
  for select using (public.can_access_group(group_id));
create policy schedules_write on public.training_schedules
  for all using (public.is_admin() or public.can_access_group(group_id))
  with check (public.is_admin() or public.can_access_group(group_id));

-- ---------- morning_checkins ----------
create policy morning_select on public.morning_checkins
  for select using (
    athlete_id = public.current_athlete_id() or public.can_access_athlete(athlete_id)
  );
create policy morning_insert on public.morning_checkins
  for insert with check (athlete_id = public.current_athlete_id());
-- athlete may correct today's own check-in; historical rows are immutable for them
create policy morning_update_own_today on public.morning_checkins
  for update using (
    athlete_id = public.current_athlete_id()
    and checkin_date = (now() at time zone coalesce(
      (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
  ) with check (athlete_id = public.current_athlete_id());
create policy morning_coach_update on public.morning_checkins
  for update using (public.is_admin() or public.can_access_athlete(athlete_id))
  with check (public.is_admin() or public.can_access_athlete(athlete_id));

-- ---------- training_sessions ----------
create policy sessions_select on public.training_sessions
  for select using (
    athlete_id = public.current_athlete_id() or public.can_access_athlete(athlete_id)
  );
create policy sessions_insert on public.training_sessions
  for insert with check (athlete_id = public.current_athlete_id());
create policy sessions_update_today on public.training_sessions
  for update using (
    athlete_id = public.current_athlete_id()
    and (started_at at time zone coalesce(
      (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
      = (now() at time zone coalesce(
        (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
  ) with check (athlete_id = public.current_athlete_id());
create policy sessions_coach_update on public.training_sessions
  for update using (public.is_admin() or public.can_access_athlete(athlete_id))
  with check (public.is_admin() or public.can_access_athlete(athlete_id));

-- ---------- post_training_checkins ----------
create policy post_select on public.post_training_checkins
  for select using (
    athlete_id = public.current_athlete_id() or public.can_access_athlete(athlete_id)
  );
create policy post_insert on public.post_training_checkins
  for insert with check (athlete_id = public.current_athlete_id());
create policy post_update_today on public.post_training_checkins
  for update using (
    athlete_id = public.current_athlete_id()
    and (submitted_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date
  ) with check (athlete_id = public.current_athlete_id());

-- ---------- readiness_snapshots ----------
create policy readiness_select on public.readiness_snapshots
  for select using (
    athlete_id = public.current_athlete_id() or public.can_access_athlete(athlete_id)
  );
-- writes go through security-definer server logic only
create policy readiness_admin_write on public.readiness_snapshots
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- alert_rules ----------
create policy alert_rules_read on public.alert_rules
  for select using (auth.role() = 'authenticated');
create policy alert_rules_admin_write on public.alert_rules
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- alerts ----------
-- Athletes do NOT read alerts (coach workflow); they see derived recommendations.
create policy alerts_select on public.alerts
  for select using (public.can_access_athlete(athlete_id));
create policy alerts_update on public.alerts
  for update using (public.is_coach() and public.can_access_athlete(athlete_id))
  with check (public.is_coach() and public.can_access_athlete(athlete_id));

-- ---------- coach_notes ----------
create policy notes_select on public.coach_notes
  for select using (public.is_coach() and public.can_access_athlete(athlete_id));
create policy notes_insert on public.coach_notes
  for insert with check (
    coach_profile_id = public.current_profile_id()
    and public.is_coach()
    and public.can_access_athlete(athlete_id)
  );
create policy notes_update on public.coach_notes
  for update using (
    coach_profile_id = public.current_profile_id() or public.is_admin()
  ) with check (
    coach_profile_id = public.current_profile_id() or public.is_admin()
  );
create policy notes_delete on public.coach_notes
  for delete using (
    coach_profile_id = public.current_profile_id() or public.is_admin()
  );

-- ---------- consent_records ----------
create policy consent_select on public.consent_records
  for select using (
    athlete_id = public.current_athlete_id() or public.can_access_athlete(athlete_id)
  );
create policy consent_write on public.consent_records
  for all using (public.is_admin() or public.can_access_athlete(athlete_id))
  with check (public.is_admin() or public.can_access_athlete(athlete_id));

-- ---------- notifications ----------
create policy notifications_select on public.notifications
  for select using (profile_id = public.current_profile_id());
create policy notifications_update on public.notifications
  for update using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());

-- ---------- audit_logs ----------
create policy audit_admin_read on public.audit_logs
  for select using (public.is_admin());
