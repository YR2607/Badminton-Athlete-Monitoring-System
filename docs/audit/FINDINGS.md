# RallyMonitor — Audit Findings

Severity: **P0** critical · **P1** high · **P2** medium · **P3** low.
Status: **FIXED** (code + regression proof) · **DOCUMENTED** (accepted/residual, rationale recorded) · **NOT VERIFIED** (needs external action).

No P0 findings were identified. All P1 findings are fixed and re-verified live.

---

## P1 — Confirmed defects, all fixed

### F-01 Athletes could write `training_schedules` — FIXED
- **File:** `supabase/migrations/0002_rls.sql` (`schedules_write`), fixed by `0005_security_hardening.sql`
- **Root cause:** `can_access_group()` returns true for *athlete members* of a group; the write policy reused it. `for all` granted INSERT/UPDATE/DELETE.
- **Evidence (live):** authenticated as the demo athlete, `POST /rest/v1/training_schedules` returned `201` and created a row (removed during cleanup).
- **Impact:** any athlete could alter or delete the club's training schedule, corrupting missed-session detection.
- **Fix:** writes now require `is_admin()` or a `coach_assignments` row for that group.
- **Verification:** same request now returns `42501`; unit test added in `tests/rls.integration.test.ts`.

### F-02 Coaches could write `consent_records` — FIXED
- **File:** `0002_rls.sql` (`consent_write`) → `0005`
- **Root cause:** policy allowed `can_access_athlete()`, which includes coaches. Consent is a legal/admin function.
- **Evidence (live):** coach JWT inserted `consent_type='coach_forge_test', status='granted'` — `201`.
- **Fix:** consent writes are admin-only. Coaches keep read access for their athletes.
- **Verification:** replay returns `42501`; test added.

### F-03 Athletes could backfill `morning_checkins` — FIXED
- **File:** `0002_rls.sql` (`morning_insert`, `morning_update_own_today`) → `0005`
- **Root cause:** insert policy only checked `athlete_id`; update `WITH CHECK` did not pin `checkin_date`, so an athlete could also move a row to a different date.
- **Evidence (live):** athlete inserted a check-in dated `2020-01-01` — `201`.
- **Impact:** fabricated history silently reshapes the personal baseline and defeats "historical rows are immutable".
- **Fix:** insert requires `checkin_date = athlete-local today`; update pins the date to the same rule.
- **Verification:** replay `42501`; today's insert still reaches the unique constraint (`23505`), i.e. the legit path works; test added.

### F-04 Password reset flow was unreachable — FIXED
- **Files:** `src/proxy.ts`, `src/app/actions/auth.ts`; new `src/app/auth/callback/route.ts`
- **Root cause:** `/auth/callback` was whitelisted in the proxy but the route did not exist; `/reset-password` required a session, so logged-out users were bounced to `/login` and the recovery code was lost.
- **Fix:** callback route exchanges the PKCE `code` (or `token_hash` OTP) for a session and redirects to `next` (open-redirect guarded); reset emails now point through it.
- **Verification:** `next build` lists `/auth/callback`; end-to-end email delivery is NOT VERIFIED (needs Site URL + SMTP).

### F-05 Server-action IDOR on session / post-check-in writes — FIXED
- **File:** `src/app/actions/coach.ts`
- **Root cause:** `coachUpsertSession` updated `.eq("id", f.id)` with `athlete_id` taken from the payload; `coachUpsertPostCheckin` upserted on `training_session_id` without ownership check. `canAccess` validated only the payload `athlete_id`, so a forged `id` let a coach overwrite/reassign another coach's athlete's rows.
- **Fix:** session update scoped `.eq("athlete_id", f.athlete_id)` with an affected-row check (`not_found` otherwise); post-check-in requires the session to belong to the same athlete; dates validated (`NaN` guard).
- **Verification:** typecheck + code path review; equivalent REST-level protection proven by RLS tests.

### F-06 Profile self-insert could claim a privileged role — FIXED
- **File:** `0002_rls.sql` (`profiles_insert_self`) → `0005`
- **Root cause:** insert policy only required `user_id = auth.uid()` — no role constraint. The role-escalation trigger covered UPDATE only.
- **Impact:** an authenticated user lacking a profile row (edge case if `handle_new_user` failed) could insert `role='admin'`.
- **Fix:** self-insert allowed only with `role='athlete'`; admins unrestricted.
- **Verification (live):** `POST /rest/v1/profiles {role:'admin'}` as athlete → `42501`.

### F-07 Athlete could self-record alerts via `record_alert` — FIXED
- **File:** `0002_rls.sql` (RPC) → `0005`
- **Root cause:** RPC allowed `p_athlete_id = current_athlete_id()`.
- **Impact:** self-spam / fabricated alert severities polluting the coach queue.
- **Fix:** authenticated callers must pass `can_access_athlete` (coach/admin); service role unaffected.
- **Verification (live):** athlete RPC call → `P0001 not allowed`; test added.

---

## P2 — Fixed

| # | Finding | Fix |
|---|---|---|
| F-08 | **CSV formula injection** — free-text fields (notes, symptoms, pain_location, names) starting with `= + - @` or tab execute in Excel | `esc()` prefixes such values with `'`; same guard in XLSX writer (`src/lib/export.ts`) |
| F-09 | **HTML export unescaped** — `escapeHtml` was defined then `void`-ed; athlete codes/group names interpolated raw (stored XSS in the report file) | all cells/headers/title escaped |
| F-10 | **Cron minute math mixed clocks** — `localHour(tz)*60 + new Date().getMinutes()` used server minutes; `en-GB` can also yield hour `24` | new `localMinutesOfDay()` in `src/lib/dates.ts` |
| F-11 | **`sessions_insert` unbounded** — athlete could log sessions at arbitrary past/future dates; update could move `started_at` to another day | insert bounded to [-30d, +1d]; update pins the athlete-local date (`0005`) |
| F-12 | **`post_insert` missing ownership check** — athlete could attach a post check-in to another athlete's `training_session_id` | session must belong to the caller (`0005`); verified live + test |
| F-13 | **`missing_morning` rule seeded but dead** — 9th rule had no code path | cron now evaluates it after `after_local_hour` via `record_alert` |
| F-14 | **`adminCreateUser` skipped validation** — `createUserSchema` existed but was never called; arbitrary timezone strings could crash `Intl` in cron/eval; athlete_code charset could produce invalid login emails | schema applied (email optional, code required for athletes, code charset `^[A-Za-z0-9_-]+$`) + real `Intl` timezone check |
| F-15 | **Athlete email broke code login** — a provided email replaced the derived `code@rally.local` login | athletes always get the derived email; email input removed from the athlete form |
| F-16 | **Coach actions used the coach's timezone** for session/alert evaluation | athlete's timezone fetched via `athleteAccess()` |
| F-17 | **Post-check-in "today" used UTC slice** — near-midnight local submissions could miss pain alerts | `EvalContext.timezone` + `localDate` comparison; regression test added |
| F-18 | **Snapshot `confidence` lied** — could read `sufficient` while `baseline_avg` was still null (off-by-one vs `computeBaseline`) | confidence now tracks baseline availability; regression test added |
| F-19 | **`post_update_today` used UTC date** | compares in the athlete's timezone (`0005`) |
| F-20 | **Alerts were mutable** — `alerts_update` let a coach rewrite severity/evidence/athlete_id | `alerts_review_only` trigger freezes signal fields; only `status`, `reviewed_*`, `resolution_note` change (`0005`) |
| F-21 | **`xlsx` package abandoned** — 2 high-severity advisories, unfixable via npm | replaced with `exceljs` (write path only) |
| F-22 | **`/analytics` had no role check** | `requireRole(["coach","admin"])` |
| F-23 | **`evaluateAthleteDay` failures crashed coach actions** | wrapped in try/catch like the athlete actions |
| F-24 | **Coach post-check-in edits never re-evaluated alerts** | `evaluateAthleteDay` now runs after the upsert |

## P2/P3 — Documented residual risks (accepted for pilot)

| # | Item | Why acceptable / next step |
|---|---|---|
| F-25 | `load_spike` is inert when previous-week load = 0 (ratio undefined); seeded `min_acute_minutes` param is unused | Conservative: no false spike during a first training week. Consider an absolute-load fallback later; see ALGORITHM_SPEC.md |
| F-26 | `illness_symptoms` fires on **any** non-empty symptoms text — the `keywords` param is decorative | Coach-facing by design; may be noisy. Tune via admin rules UI if needed |
| F-27 | `joint_pain` from a post check-in is always `attention` — the post form has no severity field | UI limitation; morning check-in path handles severity correctly |
| F-28 | Banned/password-reset users keep valid JWTs until expiry (~1h) — no per-user session revocation in the admin API used | Bound by Supabase JWT TTL; note for the club |
| F-29 | `signIn` distinguishes `banned` from `invalid_credentials` | Weak enumeration signal; kept because athletes need a clear "account disabled" message |
| F-30 | Athletes can read `group_memberships` rows of their group (teammate athlete_ids only, no names/PII) | Low disclosure; roster ids alone are not identifying |
| F-31 | Alert `recommendation` strings are stored in Russian only; notification titles are now localized | Alert-body i18n is a backlog item |
| F-32 | Baseline = first ≤14 days with data inside a 40-day fetch window (not rolling) | Deliberate design; documented in ALGORITHM_SPEC.md |
| F-33 | `readiness_drop` alert threshold (10) differs from the snapshot flag threshold (15) | Alert threshold is admin-configurable; flag is static context. Documented, not a defect |
| F-34 | Athlete timezone self-change gives ±1 day wiggle room around the "today" edit window | Self-data only; residual |
| F-35 | `submitTraining` is not atomic (session insert may succeed while post-check-in fails) | Orphan session rows are visible/harmless; retry path exists |
| F-36 | Dev-dependency advisories (vitest→tinypool moderate/critical in dev, braces) + `exceljs→uuid` moderate (unused `buf` code path) | Not shipped to runtime; upgrade when vitest/eslint majors allow |

## NOT VERIFIED

- E2E browser journeys — no automation; see UX_TEST_PLAN.md manual checklist.
- Email delivery for password reset (needs SMTP + Site URL).
- Backup restore drill.
- DST behaviour around `Europe/Chisinau` transitions in production timing (logic reviewed; unit-covered helpers).
