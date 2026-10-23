-- RallyMonitor DEMO seed (synthetic data only).
-- All demo athletes have athlete_code like 'DEMO-%' so they can be fully removed:
--   delete from public.athletes where athlete_code like 'DEMO-%';
--   delete from public.groups where name like 'DEMO %';
-- Auth users are NOT created here — create demo users via admin UI or API,
-- then attach athlete rows manually, or run this seed purely for schema demo.
--
-- This seed is safe to run on a fresh project: it inserts a demo group,
-- schedule rows and alert-rule defaults (rules already come via migrations).

insert into public.groups (id, name, description)
values ('d0000000-0000-4000-8000-000000000001', 'DEMO U15', 'Synthetic demo group — safe to delete')
on conflict (id) do nothing;

insert into public.training_schedules (group_id, weekday, start_time)
values
  ('d0000000-0000-4000-8000-000000000001', 1, '16:00'),
  ('d0000000-0000-4000-8000-000000000001', 3, '16:00'),
  ('d0000000-0000-4000-8000-000000000001', 5, '17:00')
on conflict (group_id, weekday, start_time) do nothing;
