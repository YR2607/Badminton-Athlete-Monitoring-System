# AI Budget Guard — Specification (proposal, not yet implemented)

Pilot budget target: **$10/month** (hard cap, enforced server-side).

## A. What exists today

- `ai_usage_logs` rows: model, input/output tokens, endpoint, run_id, profile_id
- `lib/ai/cost.ts` — `estimateCostUsd(model, in, out)` per-model pricing
- Rate limit: 10 generations/hour/profile (in-memory), cron ≤12 athletes/day
- Same-day cache prevents re-billing

## B. Proposed guard (minimal, Supabase-backed)

Before every `callAI` (cron + on-demand):

```ts
const monthStart = startOfMonth(todayInTz(tz));
const { data } = await supabase.from("ai_usage_logs")
  .select("model,input_tokens,output_tokens")
  .gte("created_at", monthStart.toISOString());
const spent = sum(estimateCostUsd(row.model, row.input_tokens, row.output_tokens));
if (spent >= BUDGET_USD) return err("budget_exceeded");
```

| Limit | Where | Value |
|---|---|---|
| Monthly budget | both paths | env `AI_MONTHLY_BUDGET_USD` = 10 |
| Daily generations | both | env `AI_DAILY_LIMIT` = 40 (warn) |
| Per-coach | on-demand | existing 10/h rate limit |
| Per-subject/day | on-demand | same-day cache (exists) |

## C. On exceed

- `budget_exceeded` → UI toast «AI временно недоступен»; run row `status:error, error:budget_exceeded`
- Cron returns `{ stopped: "budget" }`
- Core app unaffected (guard lives only in AI path)

## D. Monitoring

- Weekly: `select model, sum(input_tokens), sum(output_tokens) from ai_usage_logs group by model` → cost via `estimateCostUsd`
- `usage_log_failed` on runs flags accounting gaps (already implemented)

## E. Not implementing now

Distributed rate limiter (Upstash) — unjustified for 1–3 coaches; in-memory limit + Supabase budget check is sufficient for pilot.
