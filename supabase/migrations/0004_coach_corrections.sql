-- Track who last corrected a row (coach edits data on behalf of athletes).
alter table public.morning_checkins
  add column if not exists corrected_by uuid references public.profiles (id);
alter table public.post_training_checkins
  add column if not exists corrected_by uuid references public.profiles (id);
