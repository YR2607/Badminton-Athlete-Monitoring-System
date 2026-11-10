# RallyMonitor — Phase 3 Report

Date: 2026-11-10 · Branch: `ux/coach-admin-overhaul` (continues Phases 1–2)

## 1. What changed

### Athlete profile `/coach/athletes/[id]` — restructured IA
- Tab bar extended to **4 sections**: `Сегодня` (state + calendar + pending
  questionnaires) · `Нагрузка и восстановление` (readiness/baseline/load/pain)
  · `Развитие` (tests, growth, OSTRC, tournaments, academy, consent) ·
  **`Заметки и события`** — new tab holding recommendations, the events
  timeline and coach notes, previously scattered across today/dev.
- OSTRC history moved Load → Development (matches its long-term role).
- Tab strip scrolls horizontally on narrow viewports (`overflow-x-auto`,
  `shrink-0` pills) — no wrapping, no overlap with the report shortcut.
- Header already carries name/age/group/code + status badges (score, Δ
  baseline, open alerts) from Phase 2 — unchanged.

### Attendance `/coach/attendance`
- Bulk action «Все были» now requires a native `confirm()` — protection
  against accidental whole-group marking.
- Live «не отмечено: N» badge next to the bulk button — the coach sees how
  many athletes are still unmarked while tapping through the list.
- Existing per-athlete cards already provide full-width status buttons on
  mobile (present / absent / excused) — preserved.

### i18n
New keys in ru/ro/en: `athleteDetail.tabNotes`, `attendance.confirmAll`
(`unmarkedCount` already existed and is now surfaced in the mark UI).

## 2. Mobile QA (code review, no device lab)

| Surface | Finding | State |
|---|---|---|
| Roster `/coach/athletes` | CoachTable renders a responsive card grid (`grid sm:grid-cols-2 xl:grid-cols-3`), no table overflow | OK |
| Profile tabs | 4 pills + report link wrapped on mobile → fixed via horizontal scroll | Fixed |
| Attendance | Status buttons full-width stacked per card; bulk now confirmed | Improved |
| Bottom nav | `main` has `pb-28 md:pb-6` — content not covered | OK |
| Group pills `/coach` | Horizontal `overflow-x-auto` strip | OK |

Real-device / Playwright QA was **not** performed: no test credentials or
authenticated harness exists in the repo, and per constraints no auth bypass
was attempted. This remains the main unverified scenario (documented, not
fabricated).

## 3. Audit outcomes for Academy / Tests / Guide

Pages are structured and functional (Academy sections, test entry flow,
guide topics). No regressions found in code review; deeper IA rework is a
candidate for a follow-up phase — not silently half-changed.

## 4. Verification

- `npm run typecheck` ✅ clean
- `npm run lint` ✅ 0 errors (4 pre-existing warnings: 2× RHF `watch()`,
  2× unused vars — unchanged from Phase 1)
- `npm test` ✅ 226/226 (+9 skipped RLS integration tests)
- `npm run build` ✅ compiled successfully

## 5. Business logic / RLS

Unchanged: readiness, baseline, RPE×duration, alert engine, classification,
attendance rules, timezone handling, RLS policies. All edits are
presentation-layer only (tab routing, labels, confirm dialog, badge).
Today's score vs historical values remain explicitly separated; the
morning-score badge in the header shows the date-relevant value only.

## 6. Remaining limitations

1. No real browser QA (needs seeded test account + Playwright env).
2. Deep restructures: Academy information architecture, physical-tests
   mass-entry flow, coach guide sections — audited, intentionally deferred.
3. Report builder is a numbered single form, not a full 6-step wizard —
   adequate for current scope.
