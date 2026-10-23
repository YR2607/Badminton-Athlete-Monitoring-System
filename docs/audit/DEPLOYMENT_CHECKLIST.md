# RallyMonitor — Deployment Checklist

## Environment variables (Vercel / production)

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client+server | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client+server | `sb_publishable_…` (anon fallback accepted) |
| `SUPABASE_SECRET_KEY` | **server only** | `sb_secret_…` — never expose |
| `NEXT_PUBLIC_SITE_URL` | server | production origin — **drives password-reset redirect** |
| `CRON_SECRET` | server | long random string; `Authorization: Bearer` for `/api/cron/reminders` |
| `MORNING_REMINDER_HOUR` | server | optional, default 10 |

## Supabase project settings

- [ ] **Site URL** = production origin; add `https://<origin>/auth/callback` to redirect allow-list (Auth → URL Configuration)
- [ ] SMTP configured (or accept default Supabase mailer limits; admin reset flow works regardless)
- [ ] Email confirmations: users are provisioned with `email_confirm: true` — no self-signup exists (public signup should stay disabled)
- [ ] Rate limits: Supabase Auth throttles sign-in attempts — leave enabled (athlete codes are enumerable by design, passwords are generated)

## Migrations

- [ ] Apply `0001–0005` in order (`supabase/migrations/`). `0005_security_hardening.sql` tightens RLS — apply before opening pilot access.
- [ ] After applying, run `RUN_RLS_TESTS=1 npx vitest run tests/rls.integration.test.ts` against the project (creates temp users, cleans up).
- [ ] Verify seed rows: 9 `alert_rules`, 3 `recommendation_texts`.

## Cron

- `vercel.json` ships `*/15 * * * *` → `/api/cron/reminders`.
- **Auth:** Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set in project env vars — the existing header check works with no code change. (Earlier audit note claiming Vercel would get `403` was wrong.)
- **Plan compatibility:** Vercel **Hobby** permits only **once-daily** cron execution — a 15-minute cadence is silently degraded there and cannot deliver reminders at ~10:00 / missing-checkin alerts at ~12:00 / post-training reminders across timezones.
  - If deploying on **Hobby**: use an external scheduler hitting the endpoint every ~15 min with the bearer header — cron-job.org (free) or the ready-made `.github/workflows/cron-reminders.yml` (needs repo `secrets.CRON_SECRET` + `vars.APP_URL`; note GitHub scheduled runs may lag a few minutes).
  - If on **Pro or higher**: keep `*/15 * * * *` — no action needed.
- [ ] Decide the hosting plan and scheduler accordingly.
- [ ] Verify with `APP_URL=<deploy> ./scripts/smoke-staging.sh` — 403 without/with wrong token, 200 with `CRON_SECRET`; real `notifications`/`alerts` rows after threshold hours.
- [ ] Cron should only run on the production deployment (Vercel runs cron only in production by default).

## Backups & restore (Phase F)

- [ ] Supabase free tier: daily backups via dashboard — confirm the project tier and enable PITR if paid.
- [ ] **Run one restore drill** to a throwaway project before pilot — scripted: `scripts/restore-drill.sh` (dump prod → restore to test project → row-count verification). Needs `pg_dump`/`psql` (`brew install libpq`).
- [ ] Document who owns the recovery process and where credentials live.

## Rollback

- Code: `git revert` + redeploy previous Vercel build.
- DB: `0005` is additive policies/triggers — rollback = re-run `0002`-era policy definitions (saved in migration files) or restore backup.
- Secrets: rotate `SUPABASE_SECRET_KEY`/`CRON_SECRET` in dashboard + Vercel env if ever suspected exposed.

## Production/test separation

- Single Supabase project today. RLS integration tests create/delete their own fixtures — safe but **prefer a second project** for CI.
- Demo accounts (admin/coach/athlete) exist on production — **rotate or delete before real athletes join**.

## Security headers

- Next.js defaults apply; no custom headers configured. Consider adding `X-Frame-Options`/`Referrer-Policy` via `next.config.ts` post-pilot.
