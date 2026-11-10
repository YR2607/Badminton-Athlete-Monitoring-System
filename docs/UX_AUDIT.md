# RallyMonitor — UX Audit & Target Architecture

Date: 2026-11-10 · Branch: `ux/coach-admin-overhaul`

## 1. Page inventory

### Coach workspace

| Route | Purpose | Main problem |
|---|---|---|
| `/coach` | Daily dashboard | Athlete table mixed with command-center content; no clear "athletes" home |
| `/coach/athletes` | — (didn't exist) | Roster reachable only via dashboard scroll |
| `/coach/athletes/[id]` | Athlete profile | Tabs today/load/dev OK, header thin |
| `/coach/attendance` | Mark attendance | Week-plan editor competes with marking flow |
| `/coach/alerts` | Alert inbox | Flat list, weak severity split |
| `/coach/report` | Report builder | Builder → report, OK but dense |
| `/coach/academy` | Academy admin | Functional, CMS-like |
| `/coach/tests` | Field tests | Enter/history mixed |
| `/coach/tournaments` | Mini-tournaments | New feature (matrix, rounds, standings) |
| `/coach/guide` | Coach guide | Reference material |

### Admin workspace

| Route | Purpose | Main problem |
|---|---|---|
| `/admin` | Admin home | Only 4 counters + link wall — not a management view |
| `/admin/users` | Users & roles | Create/list/bulk in one page |
| `/admin/groups` | Groups, members, schedules | Multiple editors stacked |
| `/admin/features` | Feature flags | Config item #1 |
| `/admin/rules` | Alert rules | Config item #2 |
| `/admin/ostrc` | OSTRC zones | Config item #3 |
| `/admin/tests` | Test catalogue | Config item #4 |
| `/admin/audit` | Audit log | Standalone |

### Shared

`/analytics` — cross-role analytics; AppShell top nav + mobile bottom tabs.

## 2. Key findings

1. **No distinct workspaces.** Admin's home was a tile wall and admin nav
   duplicated coach routes; no way to switch "club management" ↔ "coach view".
2. **Coach nav put "Reports" (weekly task) on the same level as daily work**,
   while athletes/alerts lived inside the dashboard scroll.
3. **`/coach` page conflated three tasks**: daily command center, full roster
   table, group analytics — the roster dominated the first screen.
4. **Admin had no "needs attention" view** — org problems (athletes without
   groups, groups without schedules) were invisible.
5. **Config scattered** across 4 unrelated nav entries.

Already good and kept: `coachDashboard`/`classifyAthlete` (mutually-exclusive
priority buckets), `CoachTable` filters/sorting, RLS data access, i18n.

## 3. Target architecture

### Coach

- Primary: **Today** (`/coach`) · **Athletes** (`/coach/athletes`) ·
  **Attendance** · **Alerts** · **Analytics**
- More: Academy · Tests · Tournaments · Reports · Guide

`/coach` keeps: overview tiles → priority queue (check/reduce/missing/ready)
→ tapering → collapsible group analytics. Roster table moves to
`/coach/athletes` (same `CoachTable` component + filters).

### Admin

- Primary: **Overview** (`/admin`) · **Users** · **Groups** ·
  **Configuration** (`/admin/config` hub → features/rules/ostrc/tests) ·
  **Audit**
- More: Coach workspace (`/coach`) · Guide
- `/admin` becomes: club counters → needs-attention list → quick actions →
  group overview.

## 4. Guardrails respected

- No changes to readiness/baseline/load/alert/classification algorithms.
- RLS client for reads; admin client only where already used (dashboard tiles).
- All new strings in `dict.*` (ru/ro/en).
