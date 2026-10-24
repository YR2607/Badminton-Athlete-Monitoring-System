// Recommendation rules engine (Phase 8). Deterministic, unit-tested.
//
// A recommendation is a HINT for the coach, never an automatic decision and
// never medical advice for the athlete. Texts live in i18n under `recs.*`
// keyed by rule_key; `inputs` stores the triggering values for transparency.

export type RecSeverity = "info" | "reduce" | "talk" | "rest" | "medical";

export interface RecInput {
  /** Today's score z vs rolling norm (null = norm not formed). */
  z: number | null;
  /** EWMA ACWR (null = not enough load history). */
  acwr: number | null;
  /** Per-item z of today's raw answers. */
  itemZ: Record<string, number | null> | null;
  /** Acute pain / red flags reported today. */
  acutePain: boolean;
  /** OSTRC substantial problem this week (Phase 3 wires this in). */
  ostrcSubstantial?: boolean;
  /** % of predicted adult height for growth-spurt detection (Phase 4). */
  growthPct?: number | null;
}

export interface RecCandidate {
  rule_key:
    | "rest_medical"
    | "growth_spurt"
    | "reduce_load"
    | "talk"
    | "increase_load"
    | "plan_ok";
  severity: RecSeverity;
  inputs: Record<string, unknown>;
}

// Dip direction differs by scale: for sleep/recovery/mood a low raw answer is
// worse (z < -1), for fatigue/soreness/stress a high raw answer is worse.
const PHYS_LOW = ["sleep_score", "recovery_score"];
const PHYS_HIGH = ["fatigue_score", "muscle_soreness_score"];
const PSYCH_LOW = ["mood_score"];
const PSYCH_HIGH = ["stress_score"];

const dipped = (
  itemZ: Record<string, number | null> | null | undefined,
  keys: string[],
  highBad: boolean,
  threshold = 1,
): string[] =>
  (itemZ ? keys : []).filter((k) => {
    const z = itemZ?.[k];
    return z != null && (highBad ? z > threshold : z < -threshold);
  });

/**
 * Evaluate the recommendation matrix. Overriding rules (medical, growth
 * spurt) suppress the load matrix rows for the day.
 */
export function evaluateRecommendations(input: RecInput): RecCandidate[] {
  const { z, acwr, itemZ } = input;
  const out: RecCandidate[] = [];

  if (input.acutePain || input.ostrcSubstantial) {
    out.push({
      rule_key: "rest_medical",
      severity: "medical",
      inputs: { acute_pain: input.acutePain, ostrc_substantial: !!input.ostrcSubstantial },
    });
    return out; // overrides everything else for the day
  }

  const growth = input.growthPct;
  if (growth != null && growth >= 88 && growth <= 95) {
    out.push({
      rule_key: "growth_spurt",
      severity: "rest",
      inputs: { growth_pct: growth },
    });
    return out;
  }

  if (z == null) return out; // no norm yet — nothing to base advice on

  const physDip = dipped(itemZ, PHYS_LOW, false).concat(dipped(itemZ, PHYS_HIGH, true));
  const psychDip = dipped(itemZ, PSYCH_LOW, false).concat(dipped(itemZ, PSYCH_HIGH, true));
  const inputs = { z, acwr, physical_dip: physDip, psych_dip: psychDip };

  if (z < -1 && acwr != null && acwr > 1.3 && physDip.length > 0) {
    out.push({ rule_key: "reduce_load", severity: "reduce", inputs });
  } else if (z < -1 && psychDip.length > 0 && physDip.length === 0 && (acwr == null || acwr <= 1.3)) {
    out.push({ rule_key: "talk", severity: "talk", inputs });
  } else if (z >= -1 && acwr != null && acwr < 0.8) {
    out.push({ rule_key: "increase_load", severity: "info", inputs });
  } else if (z >= -1 && (acwr == null || acwr <= 1.3)) {
    out.push({ rule_key: "plan_ok", severity: "info", inputs });
  }

  return out;
}
