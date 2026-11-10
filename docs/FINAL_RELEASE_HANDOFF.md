# RallyMonitor — Final Release Handoff

Date: 2026-11-10 · Reviewed by: Devin

## 1. PR

- **URL (manual creation):**
  https://github.com/YR2607/Badminton-Athlete-Monitoring-System/compare/main...ux/coach-admin-overhaul
- **PR number:** not created — no GitHub credentials available on this
  machine (`gh` unauthenticated, GitHub MCP server unreachable, no
  `GH_TOKEN`/`GITHUB_TOKEN` in env). Creating the PR is a one-click manual
  step at the link above; suggested title: `UX overhaul: Coach and Admin workspaces`.
- A ready-made PR description is included below (§11).

## 2. State

- **Source SHA (head):** `38681f5` — pushed, tree clean.
- **Base SHA (origin/main):** `e460651`.
- **Commits:** 9 ahead / 0 behind — fast-forwardable, no conflicts expected.
- **Files changed:** 20 (incl. `docs/RELEASE_REVIEW.md`, this handoff).
- **Diff scope:** presentation layer only — `src/app/`, `src/components/`,
  `src/i18n/`, `docs/`. Zero changes in `src/lib/` (algorithms),
  `supabase/migrations/`, `tests/`.

## 3. Checks (fresh run on `38681f5`)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 errors, 4 pre-existing warnings (2× RHF `watch()`, 2× unused vars; unrelated to this diff) |
| `npm test` | PASS — 226/226 (+9 RLS integration skipped, env-gated) |
| `npm run build` | PASS — compiled successfully |

## 4. Vercel

Latest preview deployment for the pushed HEAD: **● Ready** (~16–35s builds,
auto-deploy per push works). Preview is behind **Vercel Deployment
Protection (SSO)** — rendered pages not inspectable without the owner's
Vercel session.

## 5. Migration `0026_tournaments.sql` — separate action required

Already merged in `main` (code side), **not yet applied to the remote DB**.
Analysis (read-only):

- Tables: `tournaments`, `tournament_players`, `tournament_matches` —
  clean DDL, `IF NOT EXISTS`, FK indexes present.
- RLS: SELECT for all `authenticated` (club-wide read is intended — athletes
  view tournaments); ALL writes gated by `public.is_admin() or
  public.current_role() = 'coach'` — staff only. Helper functions exist in
  `0002_rls.sql` — dependency order OK.
- Consumers: `/coach/tournaments`, `/athlete/tournaments` pages + server
  actions in `src/app/actions/tournaments.ts`.
- **Why not applied:** local files use `NNNN_name.sql` numbering while the
  remote migration history uses a different version format →
  `supabase db push` fails.

**Safe apply instructions (owner):**
1. Supabase Dashboard → SQL Editor → paste `supabase/migrations/0026_tournaments.sql` → Run (idempotent).
2. Then mark it applied: `supabase migration repair --status applied <version>` OR record the row in `supabase_migrations.schema_migrations` matching the remote versioning.
3. Verify: open `/coach/tournaments` — create/list must work without 404/RLS errors.

Do NOT run `supabase db push` blindly — it may try to re-apply the whole
mismatched history.

## 6. Business logic / RLS

Unchanged and re-verified by diff: readiness, baseline, RPE×duration, alert
engine, `classifyAthlete`, attendance rules, timezone logic, all RLS
policies, schema. The only behavioral additions are UI-layer: a native
`confirm()` before bulk attendance marking and a dead-anchor fix
(`#athletes` → `/coach/athletes`).

## 7. WARNINGS

1. **Browser QA not performed** — needs an authenticated session (SSO-protected
   preview / test accounts). One manual click-through recommended.
2. **9 RLS integration tests skipped** — require live Supabase env by design.
3. **Migration 0026 unapplied** on remote — tournaments UI will error until §5 done.
4. **4 pre-existing lint warnings** — unrelated to this diff.
5. `PageHeader`/`EmptyState`/`StatCard` exported but unused (foundation).

## 8. Owner's manual checklist before merge

- [ ] Create PR via link in §1 (title: `UX overhaul: Coach and Admin workspaces`)
- [ ] Open Vercel preview (SSO) → login → `/coach` → athlete profile →
      attendance → `/admin` — ~5 min click-through on phone viewport
- [ ] Apply migration 0026 per §5 (or confirm tournaments already work on prod)
- [ ] Merge when satisfied — branch is fast-forwardable

## 9. Verdict

**READY FOR FINAL HUMAN REVIEW** — all technical gates pass; the only
outstanding steps are mechanical (PR creation needs your GitHub auth) and
the 5-minute manual preview check.

## 10. Suggested PR body (copy-paste)

```md
## UX overhaul: Coach and Admin workspaces

### Phase 1 — UX Foundation
- Coach/Admin navigation split into role workspaces (+ coach-mode switcher for admins)
- Coach dashboard: greeting header, group filter, today's training card
- `/coach/athletes` registry (search, filters, sorting)
- Admin Club Overview: metrics, Needs Attention, Quick Actions, groups, audit feed
- `/admin/config` configuration hub; alerts severity strip; analytics sections
- Shared UI: PageHeader, EmptyState, StatCard — RU/RO/EN complete

### Phase 2 — UX Completion
- Report builder numbered workflow (subject → period → metrics)
- Athlete profile header status badges (score + Δ baseline + open alerts)
- Admin users/groups organization; docs/UX_AUDIT.md, UX_PHASE2_REPORT.md

### Phase 3 — Mobile & Workflow
- Athlete profile: 4 tabs (Сегодня / Нагрузка / Развитие / Заметки и события)
- Attendance: confirm() on bulk "all present" + live unmarked counter
- Responsive tab strips; docs/UX_PHASE3_REPORT.md

### Release review (docs/RELEASE_REVIEW.md)
- Dead `#athletes` anchor fixed; auth/RLS verified untouched
- typecheck ✅ lint 0 err ✅ 226/226 tests ✅ build ✅
- Vercel preview ● Ready

### Known limitations
1. Browser QA requires a manual authenticated check (preview is SSO-protected)
2. 9 RLS integration tests skipped without live Supabase env
3. Migration `0026_tournaments.sql` still needs remote apply (see handoff doc)
4. 4 pre-existing lint warnings unrelated to this diff
```
