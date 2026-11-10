# RallyMonitor — Pilot Launch Plan

Goal: prove daily value with minimal risk before club-wide rollout.

## Scope

- **1 coach**, **1 training group**, **8–15 athletes**, **2–3 weeks**.
- Roles enabled: athlete + coach. Admin only for setup/support.
- Devices: athletes on phones (primary), coach on phone + laptop.

## Timeline

| Phase | When | What |
|---|---|---|
| Setup | Day 0 | Admin creates the group, coach account, athlete accounts; assigns athletes to group; sets the weekly schedule. |
| Onboarding | Day 1 | 20-min intro at practice: show morning + post-training questionnaires on a demo phone; explain *why* (load safety, injury prevention). |
| Pilot | Days 2–18 | Normal daily workflow per `docs/CLUB_DAILY_WORKFLOW.md`. |
| Review | Day 19–21 | Coach + admin retro; metrics review; go/no-go for rollout. |

## Responsibilities

- **Owner/Admin**: account setup, schedule, incident escalation, data-protection oversight.
- **Coach**: daily usage, notes completeness, feedback collection.
- **Athletes/parents**: informed consent for monitoring data (minors — parental consent required before enrollment).

## Daily procedure (pilot)

- Athletes: morning questionnaire before practice; post-training after.
- Coach: dashboard check morning + evening; attendance on court.
- Admin: fix accounts/access issues same day.

## Success criteria (measure, don't guess)

| Metric | Target |
|---|---|
| Morning questionnaire completion | ≥ 80% of training days per athlete |
| Post-training completion | ≥ 70% |
| Attendance marking | 100% of sessions marked same day |
| Coach daily time in app | ≤ 10 min |
| Missing critical alerts | 0 |
| Coach satisfaction (1–5) | ≥ 4 |

Collect numbers from the app's own data (completion rates are visible in
`/coach` tiles and `/analytics` coverage). Do not estimate.

## Feedback collection

- Quick channel: club chat thread "RallyMonitor feedback".
- Severity per `docs/CLUB_FEEDBACK_PROCESS.md` (P0–P3).
- Weekly 15-min coach check-in.

## Incident reporting

P0 (data loss, wrong athlete data, auth failure, missing acute alert):
report immediately to admin + log in the feedback thread with [P0] tag;
stop affected workflow if unsafe. Technical contact: repository owner.

## Exit criteria → wider rollout

- All success metrics met for 2 consecutive weeks, OR
- Metrics missed → list causes, fix top issues, extend pilot 1 week.
- Any unresolved P0 → hold rollout.

## Data protection

- Real names only inside the app; feedback/chat refers to athletes by code.
- No screenshots with minors' data outside the club.
- Pilot athletes may opt out — paper questionnaire fallback stays available.
