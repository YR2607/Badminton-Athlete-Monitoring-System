# RallyMonitor — Test Results (2026-10-23)

## Latest run — post-fix sprint (branch `fix/timezone-consistency`)

| Command | Result |
|---|---|
| `npx vitest run` | **60 passed, 9 skipped** (RLS suite skips without env) — 6 files |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |

New tests: +10 — `localDayUtcBounds`/`localRangeUtcBounds` (Chisinau, New York, 23h & 25h DST days), `isValidTimeZone`, post-training pain local-day rules (3 cases), load-window local-day edges (2 cases).

## Audit run — `main` @ c98aaef

| Command | Result |
|---|---|
| `npx vitest run` | **50 passed, 9 skipped** — 6 files |
| `RUN_RLS_TESTS=1 npx vitest run tests/rls.integration.test.ts` | **9/9 passed** against the live project (fixtures created + cleaned up) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 2 pre-existing "Compilation Skipped" warnings (React Compiler) |
| `npm run build` | success — incl. new `/auth/callback` route |
| `npm audit` | 10 advisories — **dev-only** deps (vitest→tinypool critical in workers, braces, @vitest/mocker) + `exceljs→uuid` moderate (vulnerable `buf` path unused); `xlsx` high-severity pair removed |

## Live RLS negative tests (executed via PostgREST, real JWTs)

| Test | Before fix | After fix |
|---|---|---|
| athlete INSERT `training_schedules` | 201 (bug) | 42501 denied |
| coach INSERT `consent_records` | 201 (bug) | 42501 denied |
| athlete INSERT past-date `morning_checkins` | 201 (bug) | 42501 denied |
| athlete INSERT today `morning_checkins` | — | reaches unique check (23505) — allowed path intact |
| athlete RPC `record_alert` (self) | allowed (bug) | P0001 denied |
| athlete INSERT `profiles role='admin'` | allowed path (bug) | 42501 denied |
| athlete read `alerts`, `coach_notes` | `[]` | `[]` |
| athlete INSERT `audit_logs` | 42501 | 42501 |
| athlete INSERT `consent_records` | 42501 | 42501 |
| unassigned coach read athlete check-ins | `[]` | `[]` (test suite) |
| athlete post check-in on foreign session | allowed path | denied (policy) |

## Coverage added this audit

- `tests/alerts-edge.test.ts` — 10 cases: sd=0 baseline boundary, streak gaps, chronic=0 load, whitespace symptoms, post-pain severity + TZ boundary, confidence/baseline consistency.
- `tests/rls.integration.test.ts` — 5 new live negatives (schedules, consent, backfill, record_alert, foreign session).

## Skipped / NOT VERIFIED

- Browser E2E: no Playwright/Cypress — manual checklist in `UX_TEST_PLAN.md`.
- Email delivery of the reset link (needs SMTP + Site URL in prod).
- Backup restore drill — not executed (destructive-test rules).
- `npm audit fix` for dev deps requires major upgrades (vitest 5, eslint-config-next 14) — deferred; dev tooling only.
