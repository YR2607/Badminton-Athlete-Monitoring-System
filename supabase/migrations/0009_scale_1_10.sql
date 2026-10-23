-- 0009: wellness scales 1-5 -> 1-10 for finer granularity.
-- Existing answers are rescaled linearly (1->1, 2->3, 3->6, 4->8, 5->10)
-- so historical normalized scores stay comparable.

alter table public.morning_checkins
  drop constraint if exists morning_checkins_sleep_score_check,
  drop constraint if exists morning_checkins_recovery_score_check,
  drop constraint if exists morning_checkins_fatigue_score_check,
  drop constraint if exists morning_checkins_muscle_soreness_score_check,
  drop constraint if exists morning_checkins_stress_score_check,
  drop constraint if exists morning_checkins_mood_score_check;

alter table public.post_training_checkins
  drop constraint if exists post_training_checkins_overall_feeling_check,
  drop constraint if exists post_training_checkins_leg_fatigue_check,
  drop constraint if exists post_training_checkins_arm_shoulder_fatigue_check;

update public.morning_checkins set
  sleep_score = round(1 + (sleep_score - 1) * 9.0 / 4),
  recovery_score = round(1 + (recovery_score - 1) * 9.0 / 4),
  fatigue_score = round(1 + (fatigue_score - 1) * 9.0 / 4),
  muscle_soreness_score = round(1 + (muscle_soreness_score - 1) * 9.0 / 4),
  stress_score = round(1 + (stress_score - 1) * 9.0 / 4),
  mood_score = round(1 + (mood_score - 1) * 9.0 / 4);

update public.post_training_checkins set
  overall_feeling = round(1 + (overall_feeling - 1) * 9.0 / 4),
  leg_fatigue = round(1 + (leg_fatigue - 1) * 9.0 / 4),
  arm_shoulder_fatigue = round(1 + (arm_shoulder_fatigue - 1) * 9.0 / 4);

alter table public.morning_checkins
  add constraint morning_checkins_sleep_score_check check (sleep_score between 1 and 10),
  add constraint morning_checkins_recovery_score_check check (recovery_score between 1 and 10),
  add constraint morning_checkins_fatigue_score_check check (fatigue_score between 1 and 10),
  add constraint morning_checkins_muscle_soreness_score_check check (muscle_soreness_score between 1 and 10),
  add constraint morning_checkins_stress_score_check check (stress_score between 1 and 10),
  add constraint morning_checkins_mood_score_check check (mood_score between 1 and 10);

alter table public.post_training_checkins
  add constraint post_training_checkins_overall_feeling_check check (overall_feeling between 1 and 10),
  add constraint post_training_checkins_leg_fatigue_check check (leg_fatigue between 1 and 10),
  add constraint post_training_checkins_arm_shoulder_fatigue_check check (arm_shoulder_fatigue between 1 and 10);

-- "High fatigue" threshold: 4/5 -> 7/10 (same normalized position).
update public.alert_rules
  set params = params || '{"fatigue_min":7}'::jsonb
  where code = 'repeated_fatigue';

-- Load rules are retired — session params (RPE/minutes) are no longer collected.
update public.alert_rules set enabled = false where code in ('load_spike', 'load_with_decline');
