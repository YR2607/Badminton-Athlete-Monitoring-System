# AI Coach — Production Activation Checklist

Owner-run steps. Nothing here is automated. Order matters.

## 1. Merge & deploy

- [ ] Review + merge PR #4 (`feat/ai-coach` → `main`)
- [ ] Confirm Vercel production deploy is Ready

## 2. Database (manual, Dashboard → SQL Editor)

- [ ] Paste `supabase/migrations/0027_ai_insights.sql` in full → Run
- [ ] Verify: `select count(*) from ai_insights;` → 0, no error
- [ ] Optional bookkeeping: record `0027_ai_insights` in `supabase_migrations`
- [ ] RLS spot-check (read-only): run as authenticated coach → `select` on `ai_insights` OK; as athlete → empty

## 3. Vercel environment variables

| Var | Value |
|---|---|
| `OPENAI_API_KEY` | `sk-…` (project-scoped key recommended) |
| `OPENAI_MODEL` | `gpt-4o-mini` (default if unset) |
| `AI_CRON_SECRET` | random 32+ char string |

## 4. Enable flag (pilot only)

- [ ] `feature_flags`: set `ai.enabled = true`, `group_ids = [pilot group]` or `[]` for all
- [ ] Confirm `/coach` shows AI briefing card; athlete profile «Сегодня» shows AI card
- [ ] Confirm flag OFF hides cards (toggle test)

## 5. Smoke

- [ ] Click «Сгенерировать анализ» on one test athlete → insight or insufficient appears
- [ ] `ai_insights` row created; `ai_usage_logs` row with tokens; `ai_analysis_runs` status `ok`
- [ ] Second click same day → returns cached (no new usage row)
- [ ] Thumbs 👍/👎 writes `ai_insight_feedback`
- [ ] Cron: `curl -H "Authorization: Bearer $AI_CRON_SECRET" https://<prod>/api/cron/ai-analysis` → results list; re-run → processed: 0
- [ ] Normal app unchanged: login, check-in, dashboard

## 6. Pilot

- [ ] Start `docs/PILOT_LAUNCH_PLAN.md`; monitor `ai_usage_logs` weekly vs budget
- [ ] Feedback triage via `docs/CLUB_FEEDBACK_PROCESS.md`

## Rollback

- Disable flag `ai` → UI + actions stop immediately (no schema change needed)
- Full removal: drop `ai_*` tables (additive, nothing depends on them)
