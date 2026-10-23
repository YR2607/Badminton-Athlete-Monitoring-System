# RallyMonitor — Security Matrix (post-0005)

Sources: `supabase/migrations/0002_rls.sql`, `0005_security_hardening.sql`, live negative tests 2026-10-23, `tests/rls.integration.test.ts` (9/9 pass).

Legend: **R** select · **I** insert · **U** update · **D** delete · **—** denied · **svc** service-role only (server actions / engine, bypasses RLS but code-guarded).

Actors: **anon** (no session) · **ath-A/B** (athletes) · **coach-A** (assigned to A's group) · **coach-Z** (unassigned) · **admin**.

| Table | anon | ath-A (self rows) | ath-A → B's rows | coach-A | coach-Z | admin |
|---|---|---|---|---|---|---|
| profiles | — | R/U¹ self; I only as `role='athlete'` | — | R (athletes in scope) | — | all |
| athletes | — | R self | — | R in scope | — | all |
| groups | — | R own group | — | R assigned | — | all |
| group_memberships | — | R own + group roster³ | — | R group's rows | — | all |
| coach_assignments | — | — | — | R own rows | — | all |
| training_schedules | — | R own group | — | R/I/U/D assigned group | — | all |
| morning_checkins | — | R; I today only²; U today only² | — | R/U in scope | — | all (+svc corrections) |
| training_sessions | — | R; I within [-30d,+1d]; U today² | — | R/U in scope | — | all |
| post_training_checkins | — | R; I only for own session; U today² | — | R/U in scope | — | all |
| readiness_snapshots | — | R | — | R in scope | — | R; W = svc |
| alert_rules | — | R | R | R | R | all |
| alerts | — | — | — | R; U review fields only⁴ | — | all; I = svc/`record_alert` |
| coach_notes | — | — | — | R in scope; I/U/D own notes | — | all |
| consent_records | — | R own | — | R in scope | — | all |
| notifications | — | R/U own | — | R/U own | — | svc write |
| audit_logs | — | — | — | — | — | R; I = svc |
| recommendation_texts | — | R | R | R | R | all |
| `record_alert` RPC | — | denied | denied | in scope | denied | ✓ (+svc) |

¹ Role changes blocked for non-admins by `prevent_role_self_escalation` trigger.
² "today" = `checkin_date` / local `started_at`/`submitted_at` date in the athlete's profile timezone; date cannot be moved by an update.
³ Athlete ids only — no names exposed to athletes via `profiles`/`athletes` policies.
⁴ `alerts_review_only` trigger freezes `athlete_id, rule_code, severity, triggered_at, evidence, dedup_key, source_checkin_id` for non-service callers.

## API / server-action authorization

| Surface | Auth | Scope check |
|---|---|---|
| `GET /api/health` | public | none |
| `GET /api/export` | session + `profile.role in (coach,admin)` | RLS on every table query + `scopedAthleteIds` |
| `GET /api/cron/reminders` | `Authorization: Bearer CRON_SECRET` | n/a (service client) |
| Server actions — athlete submits | session + own `athletes` row | `athlete_id` forced to caller's athlete; date forced to local today; session ownership verified |
| Server actions — coach writes | session + `role in (coach,admin)` | `athleteAccess()` RLS probe per athlete; writes scoped to that athlete |
| Server actions — admin | session + `role='admin'` | re-checked inside each action |

## Notes

- `SUPABASE_SECRET_KEY` is used only in server code (`createAdminClient`); no `NEXT_PUBLIC_` exposure.
- `audit_logs` inserts have no regular-role policy — only the service client can write.
- `notifications` inserts likewise (service only); users may only update their own rows (read_at).
- `sessions`/`morning_checkins` have no DELETE policies for non-admins — deletion is admin/service only.
- Cross-check every row against live PostgREST before/after each release: `tests/rls.integration.test.ts` runs real JWTs for all three roles.
