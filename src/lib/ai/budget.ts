import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCostUsd } from "./cost";
import { checkRateLimit } from "./rate-limit";

/**
 * Budget guard: atomic DB-level reservation via ai_budget_months.
 * Configurable via env — no code change needed.
 */
export function monthlyBudgetUsd(): number {
  const v = Number(process.env.AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

/** Generous worst-case estimate used for the reservation. */
export function estimateReservationUsd(model: string): number {
  return estimateCostUsd(model, 8_000, 1_200);
}

export async function reserveBudget(supabase: SupabaseClient, model: string) {
  const est = estimateReservationUsd(model);
  const { data, error } = await supabase.rpc("ai_reserve_budget", {
    p_est_usd: est,
    p_cap_usd: monthlyBudgetUsd(),
  });
  // RPC missing (migration not applied yet) -> degrade open, not closed;
  // an error here must not take down the app path silently though.
  if (error) return { ok: true as const, est, degraded: true };
  return data ? ({ ok: true as const, est, degraded: false }) : ({ ok: false as const, est });
}

export async function settleBudget(
  supabase: SupabaseClient,
  reservedUsd: number,
  actualUsd: number,
) {
  await supabase.rpc("ai_settle_budget", { p_reserved_usd: reservedUsd, p_actual_usd: actualUsd });
}

/** Persistent rate limit (Postgres counter); in-memory fallback pre-migration. */
export async function rateCheck(supabase: SupabaseClient, key: string, max: number, windowSec = 3600) {
  const { data, error } = await supabase.rpc("ai_rate_check", {
    p_key: key,
    p_max: max,
    p_window_sec: windowSec,
  });
  if (error) return checkRateLimit(key, max, windowSec * 1000);
  return Boolean(data);
}
