# RallyMonitor — Post-Audit Fix Sprint

Date: 2026-10-23 · Branch: `fix/timezone-consistency`
Scope: unify athlete-local date semantics across alerts, load windows, cron and exports; correct the Vercel Cron deployment note.

## Confirmed defects & fixes

### D-01 Post-training pain used a mixed UTC/local OR rule — FIXED
- **File:** `src/lib/alerts.ts` (`todayPain`)
- **Root cause:** a post check-in counted as "today" when *either* its UTC date *or* its athlete-local date matched. A report submitted just after UTC-midnight but still on the athlete's previous local day could fire on the wrong day.
- **Fix:** single rule — `localDate(submitted_at, athleteTz)`. Missing timezone falls back explicitly to `"UTC"` (documented contract, not a silent mix).
- **Tests:** `alerts-edge.test.ts` — UTC-today/local-yesterday → silent; UTC-yesterday/local-today → fires; previous local day → silent.

### D-02 Load windows bucketed sessions by UTC date — FIXED
- **File:** `src/lib/alerts.ts` (`loadIn`)
- **Root cause:** `started_at.slice(0,10)` assigns the session to its UTC day; sessions in the first/last local hours of a window leaked across window boundaries.
- **Fix:** each session is bucketed via `localDate(started_at, athleteTz)`; acute = local `today−7..today`, chronic = `today−14..today−8` (unchanged semantics).
- **Tests:** session at local 00:30 (previous UTC day) counts in-window; session at local next-day 01:00 (still today's UTC) does not leak in.

### D-03 `evaluateAthleteDay` fetch window started at UTC midnight — FIXED
- **File:** `src/lib/evaluate.ts`
- **Root cause:** `.gte("started_at", fromT00:00Z)` dropped sessions/post-check-ins from the first local hours of the 40-day window for any UTC+ timezone.
- **Fix:** window lower bound = `localDayUtcBounds(from, athleteTz).start` — the real UTC instant of that local midnight. TS-side `localDate` filtering unchanged (final word stays the athlete-local day).

### D-04 Cron "session logged today" used UTC midnight — FIXED
- **File:** `src/app/api/cron/reminders/route.ts`
- **Root cause:** `.gte("started_at", todayT00:00Z)` while `today` was athlete-local — a late-evening local session (previous UTC day) wasn't seen, and an early-morning UTC-previous session counted.
- **Fix:** `localDayUtcBounds(today, tz)` → `gte(start).lt(end)` — real local-day instants, DST-safe (23/25-hour days handled).

### D-05 Cron `notifications_created` counted attempts, not inserts — FIXED
- **File:** same route.
- **Root cause:** `upsert` without `ignoreDuplicates` always returns success; `created++` counted every attempt.
- **Fix:** `ignoreDuplicates: true` + `.select("id")` — count actual inserted rows.

### D-06 Cron silently reported success on read failures — FIXED
- **File:** same route. The four base reads now return `500 db_read_failed` on error instead of producing a misleading `{ok:true}`.

### D-07 Export timestamp filters used UTC bounds — FIXED
- **File:** `src/app/api/export/route.ts`
- **Contract (documented):** `from`/`to` are calendar dates **in the export's declared timezone** (the caller's profile TZ). Date columns (`checkin_date`, `snapshot_date`) compare as dates; timestamp columns (`started_at`, `submitted_at`, `triggered_at`, `created_at`) use `localRangeUtcBounds` → `[start, end)`, end exclusive — no more `23:59:59.999Z`.
- **Note:** athletes in different timezones share the single export TZ (coach's) — consistent, documented limitation.

### D-08 Proxy redirected cron requests to `/login` — FIXED (found during post-merge verification)
- **File:** `src/proxy.ts`
- **Root cause:** the session proxy matched `/api/cron/*` and redirected unauthenticated requests (307 → `/login`) **before** the route's Bearer check ran. Vercel Cron and any external scheduler — which only send `Authorization: Bearer` — could never reach the handler; reminders were effectively dead.
- **Fix:** `/api/cron` added to `PUBLIC_PATHS`; the route keeps its own Bearer check (missing/wrong → `403`).
- **Verified live (dev server):** no token → `403`, wrong token → `403`, app routes still 307 → `/login`.

## New helpers (`src/lib/dates.ts`)

- `localDayUtcBounds(date, tz)` → `{start, end}` UTC instants of a local calendar day (two-pass offset resolution; DST-correct).
- `localRangeUtcBounds(from, to, tz)` → `[start, end)` strings for DB filters.
- `isValidTimeZone` tested; `localMinutesOfDay` tested implicitly via bounds.

## Vercel Cron — corrected facts

- `CRON_SECRET` env var → Vercel **does** send `Authorization: Bearer <secret>` automatically. The earlier "will 403" claim was wrong and is corrected in `DEPLOYMENT_CHECKLIST.md`.
- **Hobby plan = daily cron only.** `*/15 * * * *` is kept in `vercel.json` (correct on Pro+). On Hobby, use an external scheduler: `.github/workflows/cron-reminders.yml` ships ready (needs repo `secrets.CRON_SECRET` + `vars.APP_URL`) or cron-job.org. Smoke-verify any deployment with `scripts/smoke-staging.sh`; restore drill scripted in `scripts/restore-drill.sh`.

## Verification executed

| Command | Result |
|---|---|
| `npx vitest run` | **60 passed / 9 skipped** (RLS suite skips without env) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |

New tests this sprint: **+10** (dates bounds incl. 23h/25h DST, negative offset, post-pain local-day rules ×3, load-window edges ×2, timezone validation).

## NOT VERIFIED / remaining

- RLS integration suite not re-run in this sprint (no DB changes since last verified pass — policies unchanged).
- Export/screen count reconciliation against a real dataset — manual step in `UX_TEST_PLAN.md`.
- Actual Vercel plan tier — dashboard check required.
- Cron execution proof on production — depends on chosen scheduler.
