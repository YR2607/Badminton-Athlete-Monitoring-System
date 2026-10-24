-- 0016: context calendar (Phase 5, flag 'events'). Events are scoped to a
-- single athlete OR a whole group. 'illness' periods are excluded from the
-- rolling z-score norm so a sick week doesn't drag the baseline.

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references public.athletes(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  kind text not null check (kind in ('competition', 'camp', 'school', 'illness', 'vacation', 'other')),
  title text not null check (char_length(title) between 1 and 200),
  start_date date not null,
  end_date date not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (num_nulls(athlete_id, group_id) = 1)
);

create index calendar_events_athlete_idx on public.calendar_events (athlete_id, start_date);
create index calendar_events_group_idx on public.calendar_events (group_id, start_date);

alter table public.calendar_events enable row level security;

-- Read: athlete sees own + own group's events; coach/admin via access.
create policy events_select on public.calendar_events
  for select using (
    public.is_admin()
    or (athlete_id is not null and (athlete_id = public.current_athlete_id() or public.can_access_athlete(athlete_id)))
    or (group_id is not null and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = calendar_events.group_id
        and gm.left_at is null
        and (gm.athlete_id = public.current_athlete_id() or public.can_access_athlete(gm.athlete_id))
    ))
  );

-- Write: coach/admin for any accessible athlete/group; athlete may add own
-- non-medical events (school, vacation, competition, other — not 'illness',
-- which staff confirm).
create policy events_insert on public.calendar_events
  for insert with check (
    (
      public.is_admin()
      or (athlete_id is not null and public.can_access_athlete(athlete_id))
      or (group_id is not null and exists (
        select 1 from public.group_memberships gm
        where gm.group_id = calendar_events.group_id
          and gm.left_at is null
          and public.can_access_athlete(gm.athlete_id)
      ))
    )
    or (athlete_id = public.current_athlete_id() and kind in ('competition', 'school', 'vacation', 'other'))
  );

create policy events_delete on public.calendar_events
  for delete using (
    public.is_admin()
    or (athlete_id is not null and public.can_access_athlete(athlete_id))
    or (athlete_id = public.current_athlete_id() and created_by = public.current_profile_id())
  );
