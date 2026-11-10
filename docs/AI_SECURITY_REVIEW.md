# AI Coach — Security & Release Review (Phase 3.7)

Scope: `feat/ai-coach` @ `8844ca5` + review fixes. Static code review + unit tests.
Live RLS/concurrency against a real DB: **NOT VERIFIED** (no test environment) — see checklist.

## 1. Authorization

| Check | Result | Evidence |
|---|---|---|
| Session + coach/admin on all actions | PASS | `staffAthlete`/`staffContext` guards in `actions/ai*.ts` |
| `scopedAthleteIds` on athlete paths | PASS | all athlete tools + `analyzeAthlete` |
| Athletes access coach insights | PASS | RLS: all policies staff-only; no athlete SELECT |
| Group boundaries | PARTIAL | `getGroupSummary` filters members by scope; group-insight reads are staff-wide (coaches see all groups — app convention) |
| Flag on all read/write paths | PASS (fixed this round) | `isFlagEnabled("ai")` in read tools, insights, feedback |
| Feedback auth | PASS | role + flag + `profile_id = auth.uid()` policy |

## 2. Privacy

| Check | Result |
|---|---|
| PII to provider | PASS — context sends `athlete_code`, never names/DOB/contacts |
| Coach notes / free text | PASS — not included in context at all (no injection surface); prompt rule #8 reserved for future |
| `store: false` | PASS — provider.ts |
| Secrets client-side | PASS — key only in `provider.ts` (server); never imported by client components |
| Logs | PASS — errors are short strings; no prompts/keys logged |
| Cross-athlete leakage | PASS — context built per-athlete with scoped fetch |

## 3. AI output safety

| Check | Result |
|---|---|
| Numeric claims vs context | PASS — `verifyEvidence` ±0.51; failures rejected |
| String evidence (dates/labels) | LOW — unverified by design |
| Diagnoses/prescriptions | PASS — system prompt rules 1/7; no plan-writing |
| Insufficient-data | PASS — explicit `insufficient` path, tested |
| Confidence/limitations visible | PASS — rendered on card |

## 4. Cost & reliability

| Check | Result |
|---|---|
| Same-day re-billing | PASS (fixed 3.6) — `cachedInsight` returns today's result |
| Duplicate cron | PASS (code-level) — run-row insert is atomic lock; 23505 → skip |
| Stale `running` run | ACCEPTABLE — on-demand reuse resets to running (retry semantics) |
| Retry policy | PASS — 1 retry on 429/5xx, 30s timeout |
| Rate limit | MEDIUM — in-memory per instance (N× limit on serverless); bounded by Supabase counters once enabled |
| Cron batch | FIXED — MAX_PER_RUN 30 → 12 (timeout safety) |
| Usage errors visible | PASS — console.error + `usage_log_failed` on run |

## 5. Database & RLS (static)

- 4 tables, RLS enabled, staff-only policies; `for all` on runs/insights also grants staff DELETE — acceptable ops cleanup, note LOW.
- Unique(run_date,kind,subject_type,subject_id) — dedup anchor. Index on insights subject.
- Idempotent (`if not exists`, `on conflict`). Cron admin-client justified: no user session.
- Apply: Dashboard SQL Editor only; record version in `supabase_migrations` optionally.

## 6. Regression

verify: typecheck ✅ · lint 0 ✅ · 252/252 ✅ · build ✅ · **CORE_CLEAN**.

## Findings

| Sev | Item | Status |
|---|---|---|
| MEDIUM | in-memory rate limit ×N instances | documented; budget guard §B covers |
| MEDIUM | live RLS/concurrency unproven | owner runs checklist on pilot env |
| LOW | string evidence unverified | limitation |
| LOW | group tools staff-wide | app convention |
| LOW | staff DELETE on runs/insights | acceptable |
| — | flag-less read tools / feedback / MAX_PER_RUN | FIXED this round |

**Verdict: READY WITH CONDITIONS** — code safe; conditions are the checklist (DB apply, env, flag, smoke).

## Phase 3.8 addendum

Budget guard implemented: atomic DB reservation (UPDATE ... WHERE under row lock — concurrent requests serialize; no bypass). Distributed rate limit via Postgres counter. Usage SELECT is admin-only (financial). MEDIUM in-memory-limit finding → resolved for generation paths.
