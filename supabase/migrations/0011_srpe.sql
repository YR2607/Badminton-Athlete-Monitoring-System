-- 0011: session-RPE load monitoring (Foster sRPE + EWMA-ACWR).
-- training_sessions already stores session_rpe (0-10), duration_minutes and a
-- generated session_load column; this adds the *planned* side of the equation
-- and seeds the new configurable alert rules.

alter table public.training_schedules
  add column planned_minutes smallint,
  add column planned_rpe smallint;

alter table public.training_schedules
  add constraint schedules_planned_minutes_check check (planned_minutes between 1 and 600),
  add constraint schedules_planned_rpe_check check (planned_rpe between 0 and 10);

-- New load rules (all coach-editable via params). Enabled but inert until the
-- 'srpe' feature flag starts filling session_rpe/session_minutes.
insert into public.alert_rules (code, severity, enabled, params, description) values
  ('acwr_high', 'review_load', true,
   '{"threshold": 1.5, "min_days": 21}'::jsonb,
   'EWMA acute/chronic workload ratio above threshold — load rose faster than the athlete adapted.'),
  ('acwr_low', 'normal', true,
   '{"threshold": 0.8, "min_days": 28}'::jsonb,
   'EWMA ACWR below threshold — athlete is detraining relative to recent chronic load.'),
  ('monotony_high', 'review_load', true,
   '{"threshold": 2.0}'::jsonb,
   'Foster monotony over the last 7 days above threshold — too little day-to-day load variation.'),
  ('plan_deviation', 'attention', true,
   '{"ratio": 1.25, "sessions": 3}'::jsonb,
   'Actual session load exceeded planned load by more than the ratio for N consecutive sessions.');

-- The old load rules stay retired; ACWR/monotony replace them.
update public.alert_rules set enabled = false
  where code in ('load_spike', 'load_with_decline');
