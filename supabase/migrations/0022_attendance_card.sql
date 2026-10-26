-- 0022: light athlete card fields + attendance tracking + avatars bucket.

alter table public.athletes
  add column if not exists photo_path text,
  add column if not exists preferred_discipline text
    check (preferred_discipline in ('MS', 'WS', 'MD', 'WD', 'XD')),
  add column if not exists play_style text
    check (play_style in ('attacking', 'defensive', 'net', 'allround')),
  add column if not exists season_goal text,
  add column if not exists racket_model text,
  add column if not exists string_tension_kg numeric(4, 1),
  add column if not exists restrung_on date;

-- Explicit staff marks; "present" is also derived from a logged session,
-- so the table only needs rows where the coach actually marked something.
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  att_date date not null,
  status text not null check (status in ('present', 'absent', 'excused')),
  marked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (athlete_id, att_date)
);

create index attendance_date_idx on public.attendance (att_date, athlete_id);

alter table public.attendance enable row level security;

create policy attendance_select on public.attendance for select using (
  athlete_id = public.current_athlete_id()
  or public.can_access_athlete(athlete_id)
  or public.is_admin()
);
create policy attendance_write on public.attendance for all using (
  public.can_access_athlete(athlete_id) or public.is_admin()
);

-- Public avatars bucket; athletes upload into their own folder {athlete_id}/,
-- staff may upload for athletes they can access.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');
create policy avatars_insert on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.athletes a
      where a.id::text = (storage.foldername(name))[1]
        and (
          a.id = public.current_athlete_id()
          or public.can_access_athlete(a.id)
          or public.is_admin()
        )
    )
  );
create policy avatars_update on storage.objects
  for update using (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.athletes a
      where a.id::text = (storage.foldername(name))[1]
        and (
          a.id = public.current_athlete_id()
          or public.can_access_athlete(a.id)
          or public.is_admin()
        )
    )
  );
create policy avatars_delete on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.athletes a
      where a.id::text = (storage.foldername(name))[1]
        and (
          a.id = public.current_athlete_id()
          or public.can_access_athlete(a.id)
          or public.is_admin()
        )
    )
  );
