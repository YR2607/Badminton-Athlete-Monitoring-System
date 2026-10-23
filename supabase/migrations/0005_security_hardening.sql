-- RallyMonitor: security hardening (audit fixes)
--
-- Fixes confirmed by live negative tests:
--  * athletes could write training_schedules (can_access_group includes members)
--  * coaches could forge consent_records (can_access_athlete covers coaches)
--  * athletes could backfill morning_checkins for arbitrary past dates
-- Plus: session/post-checkin ownership checks, profile self-insert role pin,
-- record_alert restricted to staff, immutable alert core fields.

-- ---------- training_schedules: writes only by the group's own coach or admin ----------
drop policy if exists schedules_write on public.training_schedules;
create policy schedules_write on public.training_schedules
  for all using (
    public.is_admin()
    or exists (
      select 1 from public.coach_assignments ca
      where ca.coach_profile_id = public.current_profile_id()
        and ca.group_id = training_schedules.group_id
    )
  ) with check (
    public.is_admin()
    or exists (
      select 1 from public.coach_assignments ca
      where ca.coach_profile_id = public.current_profile_id()
        and ca.group_id = training_schedules.group_id
    )
  );

-- ---------- consent_records: writes are admin-only ----------
drop policy if exists consent_write on public.consent_records;
create policy consent_write on public.consent_records
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- morning_checkins: athletes write only their local "today" ----------
drop policy if exists morning_insert on public.morning_checkins;
create policy morning_insert on public.morning_checkins
  for insert with check (
    athlete_id = public.current_athlete_id()
    and checkin_date = (now() at time zone coalesce(
      (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
  );

drop policy if exists morning_update_own_today on public.morning_checkins;
create policy morning_update_own_today on public.morning_checkins
  for update using (
    athlete_id = public.current_athlete_id()
    and checkin_date = (now() at time zone coalesce(
      (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
  ) with check (
    athlete_id = public.current_athlete_id()
    and checkin_date = (now() at time zone coalesce(
      (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
  );

-- ---------- training_sessions: bound self-reported dates, pin the local day ----------
drop policy if exists sessions_insert on public.training_sessions;
create policy sessions_insert on public.training_sessions
  for insert with check (
    athlete_id = public.current_athlete_id()
    and started_at <= now() + interval '1 day'
    and started_at >= now() - interval '30 days'
  );

drop policy if exists sessions_update_today on public.training_sessions;
create policy sessions_update_today on public.training_sessions
  for update using (
    athlete_id = public.current_athlete_id()
    and (started_at at time zone coalesce(
      (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
      = (now() at time zone coalesce(
        (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
  ) with check (
    athlete_id = public.current_athlete_id()
    and (started_at at time zone coalesce(
      (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
      = (now() at time zone coalesce(
        (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
  );

-- ---------- post_training_checkins: session must belong to the same athlete ----------
drop policy if exists post_insert on public.post_training_checkins;
create policy post_insert on public.post_training_checkins
  for insert with check (
    athlete_id = public.current_athlete_id()
    and exists (
      select 1 from public.training_sessions s
      where s.id = training_session_id
        and s.athlete_id = public.current_athlete_id()
    )
  );

drop policy if exists post_update_today on public.post_training_checkins;
create policy post_update_today on public.post_training_checkins
  for update using (
    athlete_id = public.current_athlete_id()
    and (submitted_at at time zone coalesce(
      (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
      = (now() at time zone coalesce(
        (select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC'))::date
  ) with check (
    athlete_id = public.current_athlete_id()
    and exists (
      select 1 from public.training_sessions s
      where s.id = training_session_id
        and s.athlete_id = public.current_athlete_id()
    )
  );

-- coach corrections use the service role today; allow the same through RLS
-- for defense in depth and future session-client writes.
create policy post_coach_update on public.post_training_checkins
  for update using (public.is_admin() or public.can_access_athlete(athlete_id))
  with check (public.is_admin() or public.can_access_athlete(athlete_id));

-- ---------- profiles: self-insert may never claim a privileged role ----------
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (
    public.is_admin()
    or (user_id = auth.uid() and role = 'athlete')
  );

-- ---------- record_alert: staff only (athletes may not self-report alerts) ----------
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
  -- be an assigned coach or an admin.
  if auth.role() <> 'service_role'
     and not public.can_access_athlete(p_athlete_id) then
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

-- ---------- alerts: review fields are mutable, the signal itself is not ----------
create or replace function public.alerts_review_only()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.athlete_id is distinct from old.athlete_id
     or new.rule_code is distinct from old.rule_code
     or new.severity is distinct from old.severity
     or new.triggered_at is distinct from old.triggered_at
     or new.evidence is distinct from old.evidence
     or new.dedup_key is distinct from old.dedup_key
     or new.source_checkin_id is distinct from old.source_checkin_id then
    raise exception 'only review fields (status, reviewed_*, resolution_note) may change';
  end if;
  return new;
end $$;
drop trigger if exists alerts_review_only on public.alerts;
create trigger alerts_review_only before update on public.alerts
  for each row execute function public.alerts_review_only();
