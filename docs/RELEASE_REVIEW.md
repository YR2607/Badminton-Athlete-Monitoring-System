# RallyMonitor — Release Review: `ux/coach-admin-overhaul` → `main`

Date: 2026-11-10 · Reviewed HEAD: `87c6785` (+ review fix commit `38681f5`;
current branch head `68d9796` — see `FINAL_RELEASE_HANDOFF.md` §2)

## 1. Git state

- Branch `ux/coach-admin-overhaul`: **8 commits ahead, 0 behind** `origin/main`
  at review time (now 11 ahead — subsequent commits are docs + the anchor fix).
- Working tree clean; no stray files, no `.env`, no secrets or test
  credentials in the diff (scanned for keys/tokens — none).
- Changed files: 19 — all presentation layer (pages, layout, i18n, docs).
  **Zero** changes in `src/lib/`, `supabase/migrations/`, `tests/`.

## 2. Code review findings

| # | File | Issue | Severity | Resolution |
|---|---|---|---|---|
| 1 | `src/app/coach/page.tsx:359` | Tile linked to `#athletes` — anchor removed when CoachTable moved to `/coach/athletes`. Dead link. | MEDIUM (real bug) | **Fixed** → links to `/coach/athletes` |
| 2 | `src/components/ui/page-header.tsx` | `PageHeader`/`EmptyState`/`StatCard` exported but unused so far | LOW | Accepted as foundation components; no action |
| 3 | `attendance-client.tsx` | `unmarked` badge counts athletes whose session auto-marks them present | LOW | Accurate label ("unmarked"); marking them is harmless |
| 4 | `admin/page.tsx` | 10 parallel reads via session client; joins match `audit/page.tsx` pattern | OK | No issue |

Auth preserved: `/admin/*` guarded by `requireRole("admin")` in layout;
`/coach/*` by `requireRole(["coach","admin"])` — admin coach-mode works.

## 3. Business logic / RLS

Verified untouched: readiness, baseline, RPE×duration, alert engine,
`classifyAthlete`, attendance rules, timezone logic, RLS policies, schema.
No migration files added. Morning readiness vs post-training wellness
separation preserved; header badge shows today's score with explicit date
context only.

## 4. Automated checks (fresh run)

- `npm run typecheck` — **PASS** (0 errors)
- `npm run lint` — **PASS** (0 errors; 4 pre-existing warnings: 2× RHF
  `watch()`, 2× unused vars — unchanged since Phase 1)
- `npm test` — **PASS** 226/226 (9 RLS integration tests skipped — require
  live Supabase env, gated by `RUN_RLS_TESTS`, by design)
- `npm run build` — **PASS** (Compiled successfully)

## 5. Vercel Preview

- Latest preview deployment for `87c6785`: **● Ready** (35s build).
- Preview is behind **Vercel Deployment Protection (SSO)** — rendered pages
  could not be inspected without the owner's Vercel session. Login page and
  authenticated routes unverified in a real browser — documented, not
  fabricated.

## 6. i18n

All new keys present in ru/ro/en; `Dictionary` type enforces parity
(typecheck green). No hardcoded UI strings found in the diff (scan clean —
emoji/icons only).

## 7. Browser QA

Not performed — no test accounts / authenticated harness; auth and RLS not
bypassed. All validation is code-level + build-level.

## 8. Merge readiness

**PASS:** git state · business logic isolation · RLS · auth guards ·
typecheck · lint · tests · build · i18n · preview build.

**WARNING:**
- No authenticated browser QA — recommend one manual click-through on the
  preview before merge.
- 9 RLS integration tests skipped (env-gated, by design).
- Pre-existing (outside this branch): migration `0026_tournaments.sql`
  not applied to remote DB — tournaments UI exists in `main` already;
  apply the migration before/at deploy.
- `PageHeader`/`EmptyState`/`StatCard` currently unused (dead exports).

**BLOCKER:** none.

## 9. Verdict

**READY TO MERGE** — conditional on one manual preview click-through
(coach dashboard → athlete profile → attendance → admin overview) and
applying the pending `0026` migration.
