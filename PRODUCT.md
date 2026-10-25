# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three roles (from `src/lib/types.ts`, routing, and `navGroups` in `src/components/layout/app-shell.tsx`):

- **Athletes** — youth badminton players (teens). Primary device is a phone; the app is a PWA. Their job: quick daily check-ins — a morning wellness form (sleep, recovery, fatigue, soreness, stress, mood, pain) and a post-training form (feeling, leg/arm fatigue, sRPE, pain) — plus a weekly OSTRC injury questionnaire when enabled. (Inferred: ages are teens per brief "badminton youth athlete monitoring".)
- **Coaches** — review a squad dashboard each day: who checked in, readiness scores vs personal baseline, pain flags, alert triage, per-athlete history, tests, analytics, exports. Their job is fast triage and intervention decisions, often on a phone courtside.
- **Admins** — manage users, groups, schedules, alert rules, feature flags, OSTRC zones, audit log.

## Product Purpose

RallyMonitor turns daily self-reported wellness and training-load data into an early-warning system: each athlete's check-ins are scored against their own baseline (z-score readiness), rule-engine alerts surface athletes needing attention, and coaches see one prioritized squad view before training. Success = athletes check in reliably in under a minute; coaches spot the one athlete who needs a conversation today.

## Positioning

Baseline-relative monitoring for youth badminton, not a generic fitness log: readiness is computed per athlete against their rolling norm, alerts carry structured evidence (z-score, days-below-baseline, ACWR, growth-velocity flags), and the whole loop — check-in → snapshot → alert → coach action — is the product.

## Operating Context

- Daily ritual, twice a day: morning check-in before/around school, post-training check-in after practice; weekly OSTRC survey.
- Coach checks the dashboard before/after sessions, frequently on mobile.
- Multi-language product: ru, en, ro dictionaries (`src/i18n/`); all UI strings flow through `Dictionary`.
- PWA: manifest, service worker push notifications, safe-area bottom navigation.

## Capabilities and Constraints

- Next.js 16 App Router, Tailwind CSS 4 (`@theme` tokens in `src/app/globals.css`), Supabase (RLS reads; admin client for derived writes), server actions, react-hook-form + zod forms, recharts.
- Roles and routes: `/athlete/*`, `/coach/*`, `/admin/*`, `/analytics`, `/login`.
- Feature-flagged modules: `athlete_dashboard`, `srpe`, `zscore_baseline`, `ostrc`, `events`, `push`.
- Constraint for this redesign: visual layer only — no business logic, dictionary text, routes, or data access changes.

## Brand Commitments

- Name: **RallyMonitor** (do not rename).
- Nothing else binding; the incumbent visual system is explicitly treated as replaceable.

## Evidence on Hand

- Real product copy in three dictionaries (`src/i18n/{ru,en,ro}.ts`) — the source of all UI text.
- No photography, illustration, or logo assets in `public/` beyond PWA icons; no testimonials or marketing claims exist — do not fabricate any.

## Product Principles

1. **Triage first**: the coach's first screen must answer "who needs me today" before anything else.
2. **One-minute athlete ritual**: check-in forms are the product's heartbeat; scales must be thumb-fast and feel lightweight.
3. **Evidence over vibes**: every alert and score shows its numbers; trust comes from visible data.
4. **Teen energy, coach credibility**: the product lives with teenagers daily but is judged by their coaches.

## Accessibility & Inclusion

Mobile-first PWA; 44px+ touch targets; trilingual UI; readable type at small sizes for teens and for coaches mid-session.
