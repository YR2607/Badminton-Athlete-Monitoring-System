-- Training types are no longer used: the schedule only needs weekday + start
-- time, and session rows are auto-created markers without parameters.
alter table public.training_schedules drop column if exists training_type;
alter table public.training_sessions drop column if exists training_type;
drop type if exists public.training_type;
