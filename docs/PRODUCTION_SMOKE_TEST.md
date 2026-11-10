# RallyMonitor — Production Smoke Test

Date: 2026-11-10 · Environment: https://badminton-athlete-monitoring-system.vercel.app
Status legend: VERIFIED / NOT TESTED / BLOCKED / NEEDS OWNER ACTION

> Automated/agent-side testing could not authenticate (SSO-protected preview,
> no test accounts). All interactive scenarios below are **NOT TESTED** —
> they are the owner's manual checklist. Nothing here is claimed as passing.

## A. Admin (role: admin)

| # | Scenario | Status |
|---|---|---|
| 1 | Login as admin | NOT TESTED |
| 2 | `/admin` Club Overview renders (5 metrics, Needs Attention, Quick Actions, groups, audit feed) | NOT TESTED |
| 3 | `/admin/users` — table loads; Create/Bulk forms expand | NOT TESTED |
| 4 | User creation workflow end-to-end (use a test user, then delete) | NOT TESTED |
| 5 | `/admin/groups` — both sections render; week plan editable | NOT TESTED |
| 6 | `/admin/config` — hub cards navigate to features/rules/ostrc/tests | NOT TESTED |
| 7 | `/admin/audit` — log list loads | NOT TESTED |
| 8 | "Режим тренера" → `/coach` workspace → back | NOT TESTED |
| 9 | Coach role cannot reach `/admin/*` (RLS/layout guard) | NOT TESTED |

## B. Coach (role: coach)

| # | Scenario | Status |
|---|---|---|
| 1 | Login as coach | NOT TESTED |
| 2 | `/coach` dashboard: greeting, group pills, priority center, today's training | NOT TESTED |
| 3 | Group filter `?group=` scopes all tiles | NOT TESTED |
| 4 | `/coach/athletes` — search + filters + sorting | NOT TESTED |
| 5 | Athlete profile: 4 tabs (Сегодня / Нагрузка / Развитие / Заметки и события) | NOT TESTED |
| 6 | Readiness vs baseline + date context correct | NOT TESTED |
| 7 | `/coach/alerts` — severity strip + list actions | NOT TESTED |
| 8 | `/coach/attendance` — mark one athlete; "Все были" asks confirmation | NOT TESTED |
| 9 | `/analytics` — 4 thematic sections render | NOT TESTED |
| 10 | `/coach/report` — build group + athlete report, export CSV/XLSX/print | NOT TESTED |
| 11 | `/coach/tests` — result entry | NOT TESTED |
| 12 | `/coach/academy` — content/progress sections | NOT TESTED |

## C. Athlete (role: athlete)

| # | Scenario | Status |
|---|---|---|
| 1 | Login as athlete | NOT TESTED |
| 2 | Morning questionnaire: validation, submission, duplicate-guard | NOT TESTED |
| 3 | Post-training: RPE, duration, pain reporting | NOT TESTED |
| 4 | Own history visible; other athletes' data NOT visible | NOT TESTED |
| 5 | Coach notes NOT visible to athlete | NOT TESTED |
| 6 | `/admin/*` and `/coach/*` inaccessible | NOT TESTED |
| 7 | Tournaments view works (tables verified live in DB) | NOT TESTED |

## D. Mobile (390×844 and 375×667)

| # | Scenario | Status |
|---|---|---|
| 1 | Bottom nav usable; content not covered | NOT TESTED |
| 2 | Profile tab pills scroll horizontally | NOT TESTED |
| 3 | Attendance buttons reachable one-handed | NOT TESTED |
| 4 | Long athlete names don't break layout | NOT TESTED |
| 5 | No horizontal page overflow on /coach, /coach/athletes, attendance, analytics | NOT TESTED |

## Environment notes

- Vercel preview/prod deployments: **● Ready** (VERIFIED via `vercel ls`).
- Tournament DB tables: **VERIFIED** present on remote (read-only PostgREST probe).
- Automated checks: typecheck/lint/tests/build — **VERIFIED** green at `38681f5` code HEAD.
