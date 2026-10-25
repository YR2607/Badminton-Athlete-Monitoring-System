---
name: RallyMonitor
description: Rally cockpit — badminton athlete monitoring rendered as the scoring sheet and the performance board
colors:
  background: "#080d18"
  surface: "#0f1728"
  surface-2: "#16233c"
  field: "#0b1120"
  foreground: "#edf2fa"
  muted: "#8fa0bd"
  border: "#233350"
  accent: "#b9f22e"
  accent-foreground: "#0d1305"
  accent-2: "#5cc8f5"
  ok: "#4ade80"
  warn: "#fbbf24"
  danger: "#f87171"
typography:
  display:
    fontFamily: "Sofia Sans Condensed, Sofia Sans, system-ui, sans-serif"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Sofia Sans, system-ui, sans-serif"
    fontWeight: 400
  numeric:
    fontFamily: "Sofia Sans Condensed, Sofia Sans, system-ui, sans-serif"
    fontVariantNumeric: "tabular-nums"
    letterSpacing: "-0.01em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.md}"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  field-input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "44px"
  badge-chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
  scale-cell-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
---

## Overview

RallyMonitor's visual world is the **rally cockpit**: every screen reads as the umpire's scoring sheet crossed with an athlete-management performance board. The system is fully dark — deep arena navy ground, steel hairline rules, one fluoro court-line lime as the single action color. Numerals are the interface: readiness scores, squad stats, and check-in dots are set in condensed scoreboard type and carry hierarchy by size, not decoration. It replaced a generic light SaaS card grid; that look is retired, not evolved.

The signature control is the **scoring strip** (`ScaleInput`): a 1–N tap scale rendered as one ruled row of cells — the athlete marks a cell the way an umpire crosses a rally point. The coach's home is **the board**: one bordered strip divided into hairline segments of monumental condensed numerals, ordered so triage happens at a glance courtside.

## Colors

- Grounds: `background` #080d18 (page), `surface` #0f1728 (cards/panels), `surface-2` #16233c (raised controls, dropdown rows), `field` #0b1120 (inset form fields).
- `accent` #b9f22e is reserved for action and selection: primary buttons, active nav tick, selected scale cell, links, focus rings. Never use it for status.
- `accent-2` #5cc8f5 is the data color: secondary chart series, evening check-in dots, sparklines.
- Status is hard-edged and semantic: `ok` #4ade80 (filled / good band), `warn` #fbbf24 (pending / moderate / missed session), `danger` #f87171 (priority alerts / pain / declining band).
- Tinted states use ~10–12% alpha fills with 30–40% alpha borders of the status hue (e.g. `bg-ok/10 border-ok/30`); on dark grounds never lift fills above ~15%.
- `muted` #8fa0bd is the only secondary text; it stays ≥4.5:1 on every ground it touches.

## Typography

- Display face: **Sofia Sans Condensed** (variable `--font-sofia-cond`, utility `font-display`) — headings, card titles, the wordmark, all big numerals. Cyrillic included.
- UI face: **Sofia Sans** (`--font-sofia`, default `font-sans`) — body, labels, controls.
- Numerals: the `.score-num` class (condensed + `tabular-nums`) for every score, stat, and measure; data columns keep `tabular-nums`.
- Page headings: `font-display text-3xl font-bold tracking-tight`. Card titles: `font-display text-lg font-semibold`. The wordmark and badges are uppercase.
- Badges are `text-[10px] font-bold uppercase tracking-wider` chips — scoring-sheet callouts, not pills.

## Layout

- Mobile-first PWA: single column, `max-w-6xl` centered content, fixed bottom tab bar (`md:hidden`), `pb-28` main clearance.
- Stat groups are **boards**, not card grids: one `overflow-hidden` bordered container with `grid … gap-px bg-border`, each segment `bg-surface` — hairlines come free. Used for the coach dashboard stats and OSTRC prevalence.
- Roster cells: athlete cards keep one fixed furniture order — status badge row, name + score, sparkline + check-in dots — so the squad grid reads as a lineup sheet.
- Density: hairline `divide-border` rows inside cards; `space-y-4` between cards.

## Elevation & Depth

- Flat system: no shadows on cards; the 1px `border-border` hairline is the only edge.
- Depth exists only for floating layers: dropdowns, sheets, the bottom nav, push banner — `shadow-xl shadow-black/40` plus the hairline border.
- `backdrop-blur` is used once, functionally: the sticky header and floating bottom nav over scrolling content.

## Shapes

- Cards `rounded-xl` (12px), controls `rounded-lg` (8px), chips `rounded-md` (6px), dots `rounded-full`. No pills except small filter chips.
- Scoring-strip cells share one rounded container; internal divisions are 1px borders, not gaps.
- The brand mark is a lime court-corner parallelogram (`clip-path` polygon) — the only decorative shape; no icons-as-emoji, no ornamental SVG scenes.
- Faint court-line markings (`.court-lines`, ~7% alpha) appear only on the login arena.

## Components

- **Button**: lime ink-on-dark primary (`bg-accent text-accent-foreground`), `active:scale-[0.98]`, 44px min height; secondary uses `bg-surface-2` + hairline; danger uses `bg-danger text-background`.
- **ScaleInput / scoring strip**: `radiogroup` of cells in one `border bg-field` rounded row; selected cell floods lime with dark bold condensed numeral; `min-h-12`.
- **Badge**: bordered chip, `border-{tone}/40 bg-{tone}/12 text-{tone}`, uppercase.
- **Bottom nav**: floating dark bar; active item gets a 2px lime top-edge tick + lime icon — the court-line cue.
- **Charts**: lime primary series, cyan secondary, hairline `#233350` grids, muted ticks, dark tooltip (`#16233c` on `#233350`).
- **Check-in dots**: morning `bg-ok`, evening `bg-accent-2`, missed-session `bg-warn/70` half, pain `bg-danger`, empty `bg-foreground/15`.
- **Fields**: `bg-field` inset, hairline border, lime focus ring; checkboxes/radios get `accent-color: var(--accent)`.
- **Browser surfaces**: `::selection` is lime; caret lime; thin scrollbars tinted `surface-2`.

## Do's and Don'ts

- Do let numerals lead: scale the score before adding chrome.
- Do keep every tint semantic — status colors mean state; lime means "act".
- Don't use lime for non-interactive decoration beyond the brand mark.
- Don't add shadows, gradients, glass, or borders thicker than 1px on cards and list rows.
- Don't introduce light surfaces or a light theme; the world is a night hall.
- Don't use kickers/eyebrows above headings — the condensed heading carries itself.
- Don't replace drawn icons with unicode or emoji; deltas (▲▼) inside numeric strings are the only allowed glyph data marks.
