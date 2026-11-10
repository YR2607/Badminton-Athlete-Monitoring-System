/** Token cost accounting — per-model USD pricing (input/output per 1M tokens). */

const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "nvidia/nemotron-3-ultra-550b-a55b:free": { in: 0, out: 0 },
};

export function modelPricing(model: string) {
  return PRICING[model] ?? PRICING["gpt-4o-mini"];
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = modelPricing(model);
  return Math.round(((inputTokens * p.in + outputTokens * p.out) / 1_000_000) * 1e6) / 1e6;
}
