import type { AIInsight } from "./schema";

/**
 * Evidence verification: every numeric claim in insight.evidence must trace
 * back to a number actually present in the context sent to the model.
 * Collects all numbers from the context object and requires an exact-or-
 * near match (±0.51 for 1-decimal rounding tolerance).
 */

function collectNumbers(v: unknown, out: Set<number>) {
  if (typeof v === "number" && Number.isFinite(v)) {
    out.add(Math.round(v * 10) / 10);
    out.add(Math.round(v));
    return;
  }
  if (Array.isArray(v)) return v.forEach((x) => collectNumbers(x, out));
  if (v && typeof v === "object")
    return Object.values(v).forEach((x) => collectNumbers(x, out));
}

export function contextNumbers(context: unknown): Set<number> {
  const s = new Set<number>();
  collectNumbers(context, s);
  return s;
}

export interface VerifyResult {
  ok: boolean;
  unverified: { metric: string; value: number }[];
}

export function verifyEvidence(insight: AIInsight, context: unknown): VerifyResult {
  const allowed = contextNumbers(context);
  const unverified: { metric: string; value: number }[] = [];
  for (const e of insight.evidence) {
    if (typeof e.value !== "number") continue;
    const v = e.value;
    const hit = [...allowed].some((n) => Math.abs(n - v) <= 0.51);
    if (!hit) unverified.push({ metric: e.metric, value: e.value });
  }
  return { ok: unverified.length === 0, unverified };
}
