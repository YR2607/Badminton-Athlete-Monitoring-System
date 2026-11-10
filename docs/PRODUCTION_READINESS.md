# RallyMonitor — Production Readiness Report

Date: 2026-11-10 · Branch: `ux/coach-admin-overhaul` → `main`

## 1. Repository & branch

| Item | Status |
|---|---|
| Working tree | PASS — clean, no stray/secret files |
| Head SHA | `68d9796` (docs) / code HEAD `38681f5` |
| Base `origin/main` | `e460651` |
| Commits | 11 ahead / 0 behind — fast-forward, no conflicts |
| Changed files | 22 — presentation layer + docs only |

## 2. PR status — WARNING

Not created: no GitHub auth on this machine (`gh` unauthenticated, GitHub
MCP unreachable, no token in env). One-click link:

https://github.com/YR2607/Badminton-Athlete-Monitoring-System/compare/main...ux/coach-admin-overhaul

Title: `UX overhaul: Coach and Admin workspaces` · body: `docs/FINAL_RELEASE_HANDOFF.md` §10.

## 3. Database — migration 0026 — PASS (verified live)

Remote schema probed read-only via PostgREST (publishable key):

| Check | Result |
|---|---|
| `tournaments` (+ `courts`, `status`) | EXISTS (200) |
| `tournament_players` (+ `seed`, `athlete_id`) | EXISTS (200) |
| `tournament_matches` (+ `player_a_seed`, `score_a`) | EXISTS (200) |
| Anonymous read | `[]` — consistent with RLS `authenticated` policies |

**The earlier "not applied" warning is rescinded** — the tables, columns
and RLS behavior are already live on production. Tournament functionality
is safe to use. Only caveat: `supabase_migrations` history may lack the
0026 version row (direct Postgres check needs DB password, unavailable).
Impact: only future `db push` bookkeeping, not app function.

Optional tidy-up (owner, dashboard SQL): insert the missing version row in
`supabase_migrations.schema_migrations` so `db push`/`list` reconcile.
Do NOT run `supabase db push` blindly — local `NNNN_name` numbering
differs from remote format.

## 4. Security & business logic — PASS

- Diff contains zero changes to `src/lib/` algorithms, `supabase/migrations/`,
  tests, RLS. Verified by `git diff main...HEAD`.
- Auth guards: `/admin/*` → `requireRole("admin")`, `/coach/*` →
  `requireRole(["coach","admin"])` in layouts.
- All reads via session client (RLS applies); no service-role leaks added.
- Coach notes/recommendations remain staff-side surfaces; athlete routes
  untouched.

## 5. Browser QA — NOT TESTED

Vercel preview is SSO-protected; no test accounts exist locally. Manual
checklist for owner (§10) — coach flow, admin flow, 3 mobile viewports.

## 6. Automated validation (fresh run, HEAD `74e02ab`; code last changed `38681f5`)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 errors, 4 pre-existing warnings |
| `npm test` | PASS — 226/226 (+9 RLS tests skipped, env-gated) |
| `npm run build` | PASS |
| Vercel preview | ● Ready (auto-deploy per push; SSO-protected) |

## 7. Deployment sequence

**A. Pre-merge** — create PR → review diff → CI/Vercel green → owner preview click-through.
**B. Database** — already live; optionally record 0026 in migration history (§3).
**C. Release** — merge → watch Vercel prod deploy → verify login, `/coach`, `/admin`.
**D. Monitor** — auth errors, dashboard load, attendance saves, tournament pages.

## 8. Rollback runbook

- App: `git revert` merge commit or `vercel rollback` to previous production deployment (previous prod SHA = current `main` `e460651`).
- DB: migration 0026 creates NEW tables only — no existing data touched; rollback does NOT require dropping them (leave in place; they're additive and RLS-gated). Never auto-drop `tournaments*` if real data may exist.
- UX branch removal: not required; keep for reference.

## 9. Remaining blockers

None. **Warnings only:** PR not created (auth), browser QA not run (SSO/no accounts), 9 env-gated RLS tests skipped.

## 10. Owner actions required

- [ ] Create PR (link §2) + paste body from `FINAL_RELEASE_HANDOFF.md` §10
- [ ] Preview click-through: login → `/coach` (group switch, athlete profile 4 tabs, attendance + bulk confirm, alerts) → `/admin` (overview, users, groups, config, audit) → coach-mode toggle; on 390×844 viewport
- [ ] Optionally record 0026 in remote migration history (§3)
- [ ] Merge → verify prod deploy → smoke-check login

## 11. Verdict

**READY WITH CONDITIONS** — code, build, security and database state
verified; remaining steps are owner's manual actions (PR creation,
5-minute preview check, merge decision).
