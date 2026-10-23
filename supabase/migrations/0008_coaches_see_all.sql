-- Coaches now see every athlete; assignments are no longer needed.
-- The access helpers are redefined so all existing RLS policies that call
-- them keep working without per-policy changes.

create or replace function public.can_access_athlete(p_athlete_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select public.is_coach()
$$;

-- Athletes keep access to their own group's data (e.g. schedule).
create or replace function public.can_access_group(p_group_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select
    public.is_coach()
    or exists (
      select 1 from public.group_memberships gm
      join public.athletes a on a.id = gm.athlete_id
      join public.profiles p on p.id = a.profile_id
      where gm.group_id = p_group_id and gm.left_at is null
        and p.user_id = auth.uid()
    )
$$;

-- Schedule writes: any coach or admin (previously only the assigned coach).
drop policy if exists schedules_write on public.training_schedules;
create policy schedules_write on public.training_schedules
  for all using (public.is_coach())
  with check (public.is_coach());

drop table public.coach_assignments;
