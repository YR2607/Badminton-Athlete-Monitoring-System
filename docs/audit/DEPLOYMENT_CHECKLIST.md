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

- [ ] `vercel.json` ships `*/15 * * * *` → `/api/cron/reminders`. Vercel Cron calls it **without** the bearer header — either keep the endpoint protected by `CRON_SECRET` and use an external scheduler (cron-job.org / GitHub Actions), or accept Vercel's OIDC. **Decide before launch** — as deployed, Vercel Cron will receive `403`.
- [ ] Confirm `notifications` and `alerts` (missing_morning) rows appear after threshold hours on staging data.

## Backups & restore (Phase F)

- [ ] Supabase free tier: daily backups via dashboard — confirm the project tier and enable PITR if paid.
- [ ] **Run one restore drill** to a throwaway project before pilot: restore → spot-check `morning_checkins`, `athletes`, `profiles` counts.
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
