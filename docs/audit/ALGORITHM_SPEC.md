# RallyMonitor — Algorithm Specification (as implemented)

Sources: `src/lib/readiness.ts`, `src/lib/alerts.ts`, `src/lib/evaluate.ts`, `src/lib/dates.ts`, `supabase/migrations/0003_functions_seed.sql`, `src/app/api/cron/reminders/route.ts`.

> Scores and alerts are coaching-support signals. They are **not** medical diagnoses and **not** validated injury-risk predictions.

## 1. Readiness score (0–100)

Six morning answers, each on a 1–5 scale, are normalized to 0–1 with **higher = better**:

| Component | Raw field | Transform | Weight |
|---|---|---|---|
| sleep | `sleep_score` | `(v−1)/4` | 0.20 |
| recovery | `recovery_score` | `(v−1)/4` | 0.25 |
| fatigue | `fatigue_score` | `(5−v)/4` (inverted) | 0.20 |
| soreness | `muscle_soreness_score` | `(5−v)/4` (inverted) | 0.15 |
| stress | `stress_score` | `(5−v)/4` (inverted) | 0.10 |
| mood | `mood_score` | `(v−1)/4` | 0.10 |

`readiness = round(Σ(component·weight)/Σweights · 10000)/100` → 0–100.
All-5/1-5 answers ⇒ 100; all worst ⇒ 0; mid answers (3) ⇒ 50 ± weights.

- **Missing/invalid input:** impossible at rest — every field is `NOT NULL` with DB `CHECK 1–5` and zod `int 1–5` on all write paths.
- **Pain/illness never reduces the score.** Pain is evaluated by alert rules independently — a 100-readiness day with acute pain still produces a `priority` alert (test `alerts.test.ts` proves isolation).
- **Bands** (`bandForScore`/`bandAdviceKey`): ≥70 good · 45–69 moderate · <45 low.
- **Rounding:** 2 decimals, `Math.round` — no clamping needed (inputs bounded).

## 2. Personal baseline

`computeBaseline(series)`:
- Input = athlete's daily readiness values **ascending**, first `BASELINE_WINDOW_DAYS = 14` values **with data** (gaps are never zero-filled).
- Requires `MIN_BASELINE_OBSERVATIONS = 8`; otherwise `null` → no baseline-dependent alerts.
- Output: `avg` (population mean), `sd` (population SD), `count`, `version`.
- Implemented as a **founding baseline** (first 14 data days within the 40-day fetch window), not a rolling window — deliberate; changing it is a product decision.

`buildSnapshot(checkin, history)`:
- `history` = daily scores **before** the snapshot date.
- Flags: `below_personal_baseline` when `score < avg − 1·sd` (sd>0) or `score ≤ avg − 15`; plus `low_<component>` for any normalized component ≤ 0.25 (raw 1–2/5).
- `confidence`: `sufficient` iff a baseline could be computed (`baseline.count ≥ 8`), else `insufficient` — post-fix it can no longer disagree with `baseline_avg = null`.
- Snapshots upsert on `(athlete_id, snapshot_date)` — coach edits and re-submissions overwrite the same day's row; `calculated_at` records re-computation.

## 3. Dates & timezones

- `checkin_date` is a **calendar date in the athlete's profile timezone** (not the server, not UTC).
- Server actions compute "today" via `localDate(now, athleteTz)`; the DB RLS independently enforces the same rule, so direct API calls cannot cheat.
- Session/load windows use `localDate(started_at, athleteTz)`; the cron uses `localMinutesOfDay`/`localWeekday` in the athlete TZ.
- `addDays`/window math is pure UTC-date arithmetic — DST-safe.

## 4. Training load

`session_load = duration_minutes × session_rpe` — generated column, computed by Postgres.
- `duration_minutes`: int 1–600 (zod + CHECK).
- `session_rpe`: int 0–10 (zod + CHECK).
- Multiple sessions per day **sum**; zero-RPE sessions contribute 0 (recovery sessions); duplicates prevented by `(athlete_id, client_uuid)` unique.
- Load windows in rules: acute = `today−7 … today` (8 days incl. today), chronic = `today−14 … today−8` (7 days).

## 5. Alert rules (engine: `evaluateAlerts`)

Dedup key = `athleteId:rule:today(local)`; `record_alert` upserts `on conflict (dedup_key) do nothing` → re-evaluation never duplicates, never deletes history. Only signals **reported today** (athlete-local) can trigger pain rules. Severity rank: `normal < attention < review_load < priority`; per rule the strongest candidate wins.

| # | `code` | Severity (seed) | Trigger (actual code) | Lookback | Missing-data behavior |
|---|---|---|---|---|---|
| 1 | `acute_pain` | priority | today: `pain_status ∈ {acute_instability}` **or** swelling **or** movement limitation **or** severity ≥ `min_severity`(7) — morning or post check-in | today | no pain → silent |
| 2 | `illness_symptoms` | priority | today's `symptoms` non-blank (any text — `keywords` param unused) | today | empty → silent |
| 3 | `joint_pain` | review_load* | today: `pain_status ∈ {joint_tendon, other}`; severity ≥ `min_severity`(5) ⇒ `review_load`, else `attention`. *Post check-ins have no severity field ⇒ always `attention` | today | none → silent |
| 4 | `readiness_drop` | attention | `baseline` exists **and** `avg − today > sd_below(1.0)·sd` (sd>0) **or** `drop ≥ min_abs_drop(10)` | today | no baseline → silent |
| 5 | `sustained_decline` | review_load | `baseline` exists **and** each of last `days`(3) calendar days has a score **and** all `< avg` | 3d | a missing day breaks the streak (conservative) |
| 6 | `load_spike` | attention | `chronic > 0` **and** `acute/chronic ≥ ratio(1.5)` | 8d vs 7d | chronic = 0 → silent (documented gap) |
| 7 | `load_with_decline` | review_load | `chronic > 0` **and** `ratio ≥ 1.3` **and** `today_score < baseline.avg` | same | no baseline / no chronic → silent |
| 8 | `repeated_fatigue` | attention | each of last `days`(3) has a check-in **and** all `fatigue_score ≥ fatigue_min(4)` | 3d | missing day breaks streak |
| 9 | `missing_morning` | attention | evaluated **in the cron**: no check-in after `after_local_hour(12)` local | today | n/a |

Every alert stores `evidence` (exact triggering values) + a `recommendation` (non-diagnostic, Russian today). Admin rule editor can change `params`, `severity`, `enabled` — engine reads them live.

## 6. Re-evaluation paths

| Trigger | Effect |
|---|---|
| athlete submits morning check-in | snapshot upsert + all rules (athlete TZ) |
| athlete submits post-training | rules re-run for the session's local day |
| coach upserts morning/session/post | write → `evaluateAthleteDay` (athlete TZ) → snapshot + alerts |
| `reevaluateAthlete` action | manual re-run for any date |
| cron `missing_morning` | alert via `record_alert` after threshold hour |

Failures in evaluation never roll back the user's write (isolated try/catch, logged as `evaluate_failed`).

## 7. Coach-facing interpretation

- Alerts explain: **what** triggered (evidence JSON shown), **when** (`triggered_at`, source check-in), **severity**, **recommendation** ("talk to the athlete / adjust load / medical evaluation if needed") — never "injured" or "diagnosis".
- Readiness is shown with its band and delta vs personal norm; "insufficient confidence" until 8 check-ins exist.
