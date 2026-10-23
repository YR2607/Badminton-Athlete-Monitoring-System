# RallyMonitor — Pre-Launch Audit Summary

Date: 2026-10-23
Audited: `main` @ c98aaef (+ prior commits)
Recommendation: **CONDITIONAL GO** for a controlled club pilot.

## Scope verified by execution (not just code reading)

| Area | Method | Result |
|---|---|---|
| RLS isolation (athlete/coach/admin) | Live negative tests + `tests/rls.integration.test.ts` (9/9) against the production project | PASS after fixes |
| Authentication flows | Code review + live API tests | PASS after `/auth/callback` fix |
| Server-action authorization | Code review | PASS after IDOR fix |
| Readiness / baseline math | Unit tests (11 + edge cases) | PASS |
| 8 implemented alert rules | Unit tests (22 incl. edge cases) | PASS |
| Exports (CSV/HTML/XLSX) | Code review; injection & escaping fixed | PASS |
| Cron endpoint | Code review; timing + rule gaps fixed | PASS |
| Unit suite | `npx vitest run` | 50/50 pass |
| Typecheck / lint / build | `tsc --noEmit`, `next lint`, `next build` | clean |
| Browser E2E | No automation configured | NOT VERIFIED — manual plan in UX_TEST_PLAN.md |
| Backups / restore | Supabase-managed, no restore test run | NOT VERIFIED — see DEPLOYMENT_CHECKLIST.md |
| Email delivery (password reset link) | Requires real SMTP/Site URL config | NOT VERIFIED end-to-end |

## Headline findings (all fixed)

1. **Athletes could write `training_schedules`** (`can_access_group` counted group members). Live-verified, fixed in migration `0005`.
2. **Coaches could write `consent_records`** (parental consent is an admin function). Live-verified, fixed.
3. **Athletes could backfill check-ins** for arbitrary past dates via direct API. Live-verified, fixed.
4. **Password reset was unreachable** — no `/auth/callback` route existed and `/reset-password` required a session. Fixed.
5. **Server-action IDOR** — a coach could overwrite/steal another athlete's session or post-check-in row by forging ids. Fixed.
6. **Profile self-insert could claim `admin` role**. Fixed at the policy level.

See FINDINGS.md for the complete list (17 fixed, 12 documented-residual).

## What remains before/around the pilot

- Deploy to Vercel with production env vars (see DEPLOYMENT_CHECKLIST.md).
- Configure Supabase Auth Site URL + real SMTP (or rely on admin resets).
- Run a restore drill on a Supabase backup.
- Club must confirm consent/retention paperwork (see PILOT_CHECKLIST.md).
- Scores and alerts support coaching decisions — they are **not** medical diagnoses or injury predictions; this is stated in the product copy and must be understood by coaches.
