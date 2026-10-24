-- 0013: persist the rolling score norm {avg, sd, days} on each snapshot so
-- the athlete dashboard can draw the "norm corridor" without recomputation.

alter table public.readiness_snapshots
  add column score_norm jsonb; -- {avg, sd, days} | null
