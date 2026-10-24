import { localDate } from "@/lib/dates";
import type {
  ConfidenceLevel,
  MorningCheckin,
  NormalizedScores,
  PostTrainingCheckin,
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

const norm = (v: number) => (v - 1) / 9; // 1..10 -> 0..1, higher = better
const inv = (v: number) => (10 - v) / 9; // 1..10 -> 1..0, inverted

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
  post?: Parameters<typeof postWellnessScore>[0] | null,
): SnapshotBuild {
  const normalized = normalizeCheckin(checkin);
  const score = conditionScore(checkin, post);
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

  // Component-level weak signals (normalized <= 0.25 means raw score 1..3 of 10)
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
    // Confidence tracks whether a personal baseline could be computed —
    // it must not report "sufficient" while baseline_avg is still null.
    confidence: confidenceFor(baseline ? baseline.count : 0),
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

/**
 * Post-training wellness (0..100): the evening check-in's three answers —
 * overall feeling plus inverted leg and arm/shoulder fatigue, equal weight.
 */
export function postWellnessScore(
  p: Pick<PostTrainingCheckin, "overall_feeling" | "leg_fatigue" | "arm_shoulder_fatigue">,
): number {
  const s = (norm(p.overall_feeling) + inv(p.leg_fatigue) + inv(p.arm_shoulder_fatigue)) / 3;
  return Math.round(s * 10000) / 100;
}

/**
 * Daily condition blends the morning check-in (richer signal) with the
 * post-training check-in when one exists for the same athlete-local day:
 * 70% morning + 30% evening. Without an evening check-in it is the morning
 * score unchanged.
 */
export const MORNING_WEIGHT = 0.7;

// ---- Phase 2: rolling personal norms (z-score) ----
//
// Norm = mean/SD over the last ROLLING_WINDOW_DAYS *excluding* today, needing
// at least ROLLING_MIN_DAYS filled days. An SD floor keeps z-scores sane when
// an athlete answers almost identically every day.
export const ROLLING_WINDOW_DAYS = 28;
export const ROLLING_MIN_DAYS = 10;
export const SD_FLOOR_SCORE = 3; // condition-score points (of 100)
export const SD_FLOOR_ITEM = 0.5; // raw scale points (of 10)

export interface RollingNorm {
  avg: number;
  sd: number;
  days: number;
}

export function rollingNorm(
  values: number[],
  sdFloor: number,
  minDays = ROLLING_MIN_DAYS,
): RollingNorm | null {
  if (values.length < minDays) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  const sd = Math.max(Math.sqrt(variance), sdFloor);
  return { avg: round2n(avg), sd: round2n(sd), days: values.length };
}

export function zScore(value: number, norm: RollingNorm | null): number | null {
  if (!norm) return null;
  return Math.round(((value - norm.avg) / norm.sd) * 1000) / 1000;
}

function round2n(v: number): number {
  return Math.round(v * 100) / 100;
}

export const MORNING_ITEM_KEYS = [
  "sleep_score",
  "recovery_score",
  "fatigue_score",
  "muscle_soreness_score",
  "stress_score",
  "mood_score",
] as const;
export type MorningItemKey = (typeof MORNING_ITEM_KEYS)[number];

/** Rolling raw-value norms for each morning questionnaire item. */
export function rollingItemNorms(
  checkins: MorningCheckin[],
): Record<MorningItemKey, RollingNorm | null> {
  const out = {} as Record<MorningItemKey, RollingNorm | null>;
  for (const k of MORNING_ITEM_KEYS) {
    out[k] = rollingNorm(
      checkins.map((c) => c[k]).filter((v): v is number => v != null),
      SD_FLOOR_ITEM,
    );
  }
  return out;
}

/** Per-item z-scores for today's raw answers against their rolling norms. */
export function itemZScores(
  checkin: MorningCheckin,
  norms: Record<MorningItemKey, RollingNorm | null>,
): Record<MorningItemKey, number | null> {
  const out = {} as Record<MorningItemKey, number | null>;
  for (const k of MORNING_ITEM_KEYS) out[k] = zScore(checkin[k], norms[k]);
  return out;
}

export function conditionScore(
  checkin: Parameters<typeof normalizeCheckin>[0],
  post?: Parameters<typeof postWellnessScore>[0] | null,
): number {
  const morning = readinessScore(normalizeCheckin(checkin));
  if (!post) return morning;
  const blended = morning * MORNING_WEIGHT + postWellnessScore(post) * (1 - MORNING_WEIGHT);
  return Math.round(blended * 100) / 100;
}

/**
 * Bucket post-training check-ins by local date; latest submission per day
 * wins. When `sessionDateById` maps check-in's training_session_id to the
 * session's local date, that date wins over submitted_at — a check-in
 * backfilling yesterday's session counts for yesterday.
 */
export function postsByLocalDate<T extends { submitted_at: string; training_session_id?: string }>(
  posts: T[],
  tz: string,
  sessionDateById?: Map<string, string>,
): { date: string; post: T }[] {
  const byDate = new Map<string, T>();
  for (const p of [...posts].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))) {
    const sid = p.training_session_id;
    const date =
      (sid ? sessionDateById?.get(sid) : undefined) ??
      localDate(new Date(p.submitted_at), tz);
    byDate.set(date, p);
  }
  return [...byDate].map(([date, post]) => ({ date, post }));
}

/**
 * Daily condition series: like dailyReadiness but each day also folds in the
 * post-training check-in dated to the same local day. `posts` maps a local
 * date to that day's check-in (latest wins if there are several).
 */
export function dailyConditionSeries(
  checkins: MorningCheckin[],
  posts: { date: string; post: Parameters<typeof postWellnessScore>[0] }[],
): { date: string; score: number }[] {
  const postByDate = new Map(posts.map((p) => [p.date, p.post]));
  return checkins
    .slice()
    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date))
    .map((c) => ({ date: c.checkin_date, score: conditionScore(c, postByDate.get(c.checkin_date)) }));
}
