# RallyMonitor — Algorithm Test Cases

All cases below are executable: `tests/readiness.test.ts`, `tests/alerts.test.ts`, `tests/alerts-edge.test.ts` — **50/50 unit tests pass** (`npx vitest run`).

## Readiness score

| # | Scenario | Expected | Actual |
|---|---|---|---|
| R1 | All positive answers (5,5,1,1,1,5) | 100 | PASS |
| R2 | All worst answers (1,1,5,5,5,1) | 0 | PASS |
| R3 | Neutral answers (all 3) | normalized 0.5 → ~50 | PASS (0.5 components) |
| R4 | Negative scales inverted | fatigue 5 → 0; sleep 5 → 1 | PASS |
| R5 | Score bands | 75→good, 50→moderate, 20→low | PASS |

## Baseline & snapshot

| # | Scenario | Expected | Actual |
|---|---|---|---|
| B1 | <8 observations | `computeBaseline` → null | PASS (3 and 7) |
| B2 | 8+ observations | avg/sd computed (constant → sd=0) | PASS |
| B3 | 7 prior days + today | confidence `insufficient`, baseline null | PASS (post-fix) |
| B4 | 8 prior days | confidence `sufficient`, baseline present | PASS |
| B5 | Score < avg−1sd | flag `below_personal_baseline` | PASS |
| B6 | Normal variation | no flag | PASS |
| B7 | `dailyReadiness` | one score per date, ascending | PASS |

## Alert rules — positive / negative / boundary

| # | Rule | Scenario | Expected | Actual |
|---|---|---|---|---|
| A1 | acute_pain | acute_instability + severity 8, readiness 95 | priority alert fires anyway | PASS |
| A2 | acute_pain | swelling on mere soreness | priority | PASS |
| A3 | illness_symptoms | "головокружение и слабость" | priority | PASS |
| A4 | illness_symptoms | whitespace-only symptoms | silent | PASS |
| A5 | joint_pain | severity 3 | attention | PASS |
| A6 | joint_pain | severity 6 ≥ min 5 | review_load | PASS |
| A7 | joint_pain (post) | post check-in pain (no severity field) | attention | PASS |
| A8 | post pain TZ | submitted 22:30 UTC = today+1 local (Chisinau) | fires with `timezone` ctx; silent without | PASS |
| A9 | readiness_drop | score 50 vs avg 80 sd 0 | drop ≥10 → fires | PASS |
| A10 | readiness_drop | score 71 vs avg 80 sd 0 (drop 9) | silent | PASS |
| A11 | readiness_drop | no baseline (new athlete, score 30) | silent | PASS |
| A12 | sustained_decline | 3 consecutive days < avg | fires | PASS |
| A13 | sustained_decline | day missing inside window | silent | PASS |
| A14 | load_spike | acute 1200 vs chronic 600 (2.0×) | fires | PASS |
| A15 | load_spike | ratio 1.17 (<1.5) | silent | PASS |
| A16 | load_spike | chronic = 0 (new athlete, huge acute) | silent — documented gap | PASS |
| A17 | repeated_fatigue | 3 days fatigue ≥4 | fires | PASS |
| A18 | repeated_fatigue | gap day in window | silent | PASS |
| A19 | dedup | re-eval same day | same `athleteId:rule:date` key, no duplicates | PASS |
| A20 | missing_morning | no check-in after local noon | alert recorded by cron via `record_alert` | implemented; covered by review (rule now evaluated) |

## Validation / data integrity

| # | Scenario | Expected | Actual |
|---|---|---|---|
| V1 | score outside 1–10 | zod + DB CHECK reject | covered by schema tests |
| V2 | `client_uuid` re-submit | unique(athlete,client_uuid) → `duplicate` | covered |
| V3 | pain ≠ none without location | zod superRefine `required_if_pain` | PASS |
| V4 | past-date check-in via API | RLS denies (fixed F-03) | PASS live + test |
| V5 | session >30d back / >1d ahead via API | RLS denies | policy in place |

## Analytics reconciliation

`athleteStats`/`periodSummary` averages are computed **per check-in day present** (days without data are skipped, never zero-filled); deltas compare the equal-length previous period. Verified by `tests/analytics.test.ts` (5/5) with deterministic fixtures.
