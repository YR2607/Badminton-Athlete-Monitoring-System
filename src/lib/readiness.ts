import type {
  ConfidenceLevel,
  MorningCheckin,
  NormalizedScores,
} from "@/lib/types";

/**
 * Readiness model — transparent, rule-based, NOT a medical or injury predictor.
 *
 * Every raw answer is normalised to 0..1 where HIGHER always means a more
 * favourable state (fatigue/soreness/stress are inverted). The readiness score
 * is the weighted mean of the six components, scaled to 0..100.
 *
 * The personal baseline is the mean/SD of daily readiness over the athlete's
 * first BASELINE_WINDOW days that contain data; it requires at least
 * MIN_BASELINE_OBSERVATIONS check-ins, otherwise confidence = "insufficient".
 */

export const BASELINE_WINDOW_DAYS = 14;
export const MIN_BASELINE_OBSERVATIONS = 8;

export const COMPONENT_WEIGHTS: Record<keyof NormalizedScores, number> = {
  sleep: 0.2,
  recovery: 0.25,
  fatigue: 0.2,
  soreness: 0.15,
  stress: 0.1,
  mood: 0.1,
};

const norm = (v: number) => (v - 1) / 4; // 1..5 -> 0..1, higher = better
const inv = (v: number) => (5 - v) / 4; // 1..5 -> 1..0, inverted

export function normalizeCheckin(
  c: Pick<
    MorningCheckin,
    | "sleep_score"
    | "recovery_score"
    | "fatigue_score"
    | "muscle_soreness_score"
    | "stress_score"
    | "mood_score"
  >,
): NormalizedScores {
  return {
    sleep: norm(c.sleep_score),
    recovery: norm(c.recovery_score),
    fatigue: inv(c.fatigue_score),
    soreness: inv(c.muscle_soreness_score),
    stress: inv(c.stress_score),
    mood: norm(c.mood_score),
  };
}

export function readinessScore(n: NormalizedScores): number {
  let sum = 0;
  let wsum = 0;
  for (const k of Object.keys(COMPONENT_WEIGHTS) as (keyof NormalizedScores)[]) {
    const w = COMPONENT_WEIGHTS[k];
    sum += n[k] * w;
    wsum += w;
  }
  return Math.round((sum / wsum) * 10000) / 100;
}

export interface Baseline {
  avg: number;
  sd: number;
  count: number;
  version: number;
}

/**
 * Baseline from the athlete's earliest daily readiness values within the
 * first BASELINE_WINDOW_DAYS days that contain data.
 */
export function computeBaseline(dailyScores: number[], version = 1): Baseline | null {
  const values = dailyScores.slice(0, BASELINE_WINDOW_DAYS);
  if (values.length < MIN_BASELINE_OBSERVATIONS) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return {
    avg: Math.round(avg * 100) / 100,
    sd: Math.round(sd * 100) / 100,
    count: values.length,
    version,
  };
}

export function confidenceFor(count: number): ConfidenceLevel {
  return count >= MIN_BASELINE_OBSERVATIONS ? "sufficient" : "insufficient";
}

export type ReadinessBand = "good" | "moderate" | "low";

export function bandForScore(score: number): ReadinessBand {
  if (score >= 70) return "good";
  if (score >= 45) return "moderate";
  return "low";
}

/** Deviations below baseline beyond this z-threshold are surfaced in explanations. */
const FLAG_Z = 1.0;

export interface SnapshotBuild {
  readiness_score: number;
  normalized_scores: NormalizedScores;
  baseline_avg: number | null;
  baseline_sd: number | null;
  baseline_version: number;
  input_data_count: number;
  confidence: ConfidenceLevel;
  explanation: {
    band: ReadinessBand;
    flags: string[];
    delta_vs_baseline: number | null;
  };
}

/**
 * Build a snapshot for a check-in. `history` = earlier daily readiness values
 * (oldest first) used for the baseline. Missing days are simply absent —
 * gaps are never substituted with zeros.
 */
export function buildSnapshot(
  checkin: Parameters<typeof normalizeCheckin>[0],
  history: number[],
  baselineVersion = 1,
): SnapshotBuild {
  const normalized = normalizeCheckin(checkin);
  const score = readinessScore(normalized);
  const baseline = computeBaseline(history, baselineVersion);

  const flags: string[] = [];
  let delta: number | null = null;
  if (baseline) {
    delta = Math.round((score - baseline.avg) * 100) / 100;
    const below =
      (baseline.sd > 0 && score < baseline.avg - FLAG_Z * baseline.sd) ||
      score <= baseline.avg - 15; // absolute drop even when sd == 0
    if (below) flags.push("below_personal_baseline");
  }

  // Component-level weak signals (normalized < 0.25 means raw score 1..2 of 5)
  for (const k of Object.keys(normalized) as (keyof NormalizedScores)[]) {
    if (normalized[k] <= 0.25) flags.push(`low_${k}`);
  }

  return {
    readiness_score: score,
    normalized_scores: normalized,
    baseline_avg: baseline?.avg ?? null,
    baseline_sd: baseline?.sd ?? null,
    baseline_version: baseline?.version ?? baselineVersion,
    input_data_count: history.length + 1,
    confidence: confidenceFor(history.length + 1),
    explanation: { band: bandForScore(score), flags, delta_vs_baseline: delta },
  };
}

/** Daily readiness series: one value per check-in date present. */
export function dailyReadiness(checkins: MorningCheckin[]): { date: string; score: number }[] {
  return checkins
    .slice()
    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date))
    .map((c) => ({ date: c.checkin_date, score: readinessScore(normalizeCheckin(c)) }));
}
