-- 0012: personal z-score norms (Phase 2).
-- Rolling 28-day norms per questionnaire item and the daily condition score,
-- evaluated on the server and stored on the snapshot. Also adds the optional
-- "sleep hours" numeric field to the morning check-in (behind the
-- 'zscore_baseline' feature flag; existing scales are untouched).

alter table public.morning_checkins
  add column sleep_hours numeric(3,1);

alter table public.morning_checkins
  add constraint morning_checkins_sleep_hours_check
    check (sleep_hours is null or (sleep_hours >= 0 and sleep_hours <= 16));

alter table public.readiness_snapshots
  add column z_score numeric(6,3),      -- z of the day's score vs rolling norm
  add column item_baselines jsonb,      -- per-item {avg, sd, days}
  add column item_zscores jsonb;        -- per-item z for the day

-- readiness_drop gains a z-threshold; the absolute/SD fallback stays.
update public.alert_rules
  set params = params || '{"z_below": 1.5}'::jsonb
  where code = 'readiness_drop';
