# RallyMonitor — Pilot Checklist for the Club

## Before first session

- [ ] Coach + admin accounts created and handed over (passwords shown **once** — save them).
- [ ] Every athlete has: code + generated password, assigned group, optional birth year.
- [ ] Athletes receive their code + password on paper/private message — **not** posted in a group chat.
- [ ] Parental/guardian consent recorded per your club's process (Admin → athlete → consent). **The club — not the app — decides the legal basis and retention for minors' wellness data in your jurisdiction.**
- [ ] Training schedule entered for each group (Admin → Groups) — drives missed-checkin and post-training reminders.
- [ ] Coaches told explicitly: **readiness scores and alerts support coaching decisions — they are not medical diagnoses or injury predictions.** Any pain/illness alert = talk to the athlete and involve parents/professionals as your protocol requires.

## Daily routine

- [ ] Morning: athletes fill the check-in on their phones (≈1 min). After 10:00 local, missing athletes get an in-app reminder; after 12:00 a `missing_morning` alert appears for the coach.
- [ ] Coach opens `/coach` → priority alerts first, then the comparison chart.
- [ ] After training: athletes log session + post check-in.
- [ ] Coach acknowledges/resolves alerts with a note (creates the audit trail).
- [ ] Data corrections go through the day page (coach edit) — never shared athlete logins.

## Weekly

- [ ] Admin reviews the audit log (Admin → Audit).
- [ ] Export a backup copy if the club wants local records (CSV/XLSX/HTML).
- [ ] Review rule thresholds if alerts feel noisy (Admin → Rules).

## Data & privacy

- [ ] Agree who can export data and where exports are stored (exports contain health-adjacent answers).
- [ ] Agree retention: what happens to a leaving athlete's data (admin can archive; deletion via DB request).
- [ ] Consent revocation → admin marks revoked + disables the account.
- [ ] No real names required — display names can be initials/nicknames; only birth **year** is stored by design.

## If something breaks

- [ ] Athlete locked out → Admin → Users → reset password (works immediately; self-reset by email also works once SMTP is configured).
- [ ] A check-in filled on paper → coach enters it via the athlete's day page.
- [ ] Report bugs with date + athlete code + what was expected.
