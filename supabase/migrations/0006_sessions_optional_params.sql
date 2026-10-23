-- Athletes no longer enter session parameters (duration, RPE, type).
-- A training_sessions row is now an auto-created marker meaning "the athlete
-- reported a training/evening check-in" — the wellness data lives in
-- post_training_checkins. Nullable params distinguish "not collected" from
-- a fake zero. session_load stays generated (NULL inputs -> NULL) so
-- historical loads remain readable in exports.

alter table public.training_sessions
  alter column duration_minutes drop not null,
  alter column training_type drop not null,
  alter column session_rpe drop not null;

-- Load-based alert rules can no longer fire without session load.
update public.alert_rules
  set enabled = false
  where code in ('load_spike', 'load_with_decline');
