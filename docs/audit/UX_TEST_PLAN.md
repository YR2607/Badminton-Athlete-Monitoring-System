# RallyMonitor — Manual UX Test Plan

No browser automation is configured — execute these manually on a **mobile viewport (375×812) and desktop** for each role. Record pass/fail per row.

## Athlete

| # | Step | Expected |
|---|---|---|
| U1 | Log in with athlete code + password | lands on `/athlete` |
| U2 | Wrong password / wrong code | generic error, no account hint |
| U3 | Complete morning check-in (all 6 sliders + "no pain") | success state; readiness + band shown |
| U4 | Re-open morning form same day | form pre-filled; save updates the same row (no duplicate) |
| U5 | Report pain: choose status, location required | cannot submit without `pain_location`; alert appears for coach |
| U6 | Report symptoms text | saves; coach gets priority alert |
| U7 | Submit post-training (session + check-in) | session + check-in linked; appears in history |
| U8 | Double-tap submit fast | one row only (client_uuid idempotency) |
| U9 | Open history | charts render; today's score present |
| U10 | Try to open `/coach`, `/admin`, `/analytics` directly | redirected to own home |
| U11 | Change language in settings | UI strings switch (ru/en/ro) |
| U12 | Timezone: pick a valid one | saves; invalid values rejected silently → try "UTC" (should save post-fix) |

## Coach

| # | Step | Expected |
|---|---|---|
| C1 | Dashboard shows today's athletes + comparison chart | missing check-ins distinct from low readiness |
| C2 | Toggle athlete chips on the chart | lines add/remove; dashed = group average |
| C3 | Open athlete profile, switch ‹ › between athletes | profile swaps without dashboard trip |
| C4 | Profile: stats block | units + explainer line visible |
| C5 | Open day page → edit yesterday's check-in | saves; readiness recalculates; `corrected_by` set |
| C6 | Add a training session for an athlete | appears in history; load totals update |
| C7 | Alerts page: acknowledge/resolve with note | status + reviewer saved; reopen = dedup prevents duplicates |
| C8 | Filter analytics (group/athlete/7d/30d/custom) | table + cards match filter; totals consistent with profile |
| C9 | Export CSV/XLSX/HTML for own athletes | downloads; numbers match on-screen |
| C10 | Try to open another club's athlete URL directly | forbidden / empty |
| C11 | Notes: add note + decision | listed under athlete, timestamped |

## Admin

| # | Step | Expected |
|---|---|---|
| AD1 | Create coach (email+password) | credentials shown once; login works |
| AD2 | Create athlete (code, group pick, no email) | code login works; email field absent for athletes |
| AD3 | Invalid athlete code chars / invalid timezone | validation error, user not created |
| AD4 | Assign coach ↔ group; move athlete between groups | coach dashboard reflects scope |
| AD5 | Regenerate password | new password works; old rejected |
| AD6 | Disable user | login → "account disabled"; existing session dies within ~1h |
| AD7 | Rules page: toggle rule, change threshold, save | engine honors new params next evaluation |
| AD8 | Audit page | user.create / password_reset / coach upserts listed |
| AD9 | Athlete name in users table → profile | opens coach athlete profile |

## Cross-cutting

| # | Check | Expected |
|---|---|---|
| X1 | All 3 languages on every screen | no missing keys, no overflow on mobile |
| X2 | Long athlete names | layout doesn't break |
| X3 | Severity/colors | not color-only (labels/badges text too) |
| X4 | Offline submit → error state | clear failure message, no phantom success |
| X5 | Keyboard navigation + focus | forms usable; focus visible |
| X6 | Slow network | loading states, no double submits |
