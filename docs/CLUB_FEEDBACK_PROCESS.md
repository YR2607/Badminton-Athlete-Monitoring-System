# RallyMonitor — Club Feedback & Issue Process

How coaches, athletes and admins report problems; how issues get prioritized.

## Where to report

- **Club chat thread** "RallyMonitor feedback" — first stop for everything.
- Include: role (coach/athlete/admin), screen, what you did, what happened,
  screenshot **without personal data** (athlete codes only).

## Severity ladder

| Level | Examples | Response |
|---|---|---|
| **P0 Critical** | Data loss; security issue; wrong athlete data shown; auth broken; acute alert missing | Stop affected use; report same hour; owner investigates first |
| **P1 High** | Daily workflow broken; questionnaire won't submit; attendance wrong; major mobile failure | Fix before next training day |
| **P2 Medium** | Confusing navigation; slow page; hard filtering; report problems | Queue for next update |
| **P3 Low** | Visual polish; wording; minor layout | Backlog, batch-fix |

## Triage rules

- Not every suggestion gets implemented. Rank by: frequency × impact ×
  affected role × risk to athlete monitoring.
- Anything touching health data interpretation (scores, alerts, pain)
  outranks convenience issues.
- Duplicate reports get merged; the reporter gets a one-line status.

## Cadence

- **During pilot:** daily scan of the thread by admin; weekly triage list.
- **After rollout:** weekly triage; P0/P1 ad-hoc.

## Escalation to development

Issues that need code changes are collected into a short list:

```
[P1] Athlete can't submit morning questionnaire on iPhone SE — "Save" button below fold
Steps: open /athlete → questionnaire → fields filled → no visible save action
Expected: visible submit; Actual: must scroll past keyboard
```

One issue per item, reproducible steps, device/browser. The owner decides
implementation order — feedback is input, not a spec.
