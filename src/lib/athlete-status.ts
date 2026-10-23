import type { Baseline } from "@/lib/readiness";
import { MIN_BASELINE_OBSERVATIONS } from "@/lib/readiness";
import { localDate } from "@/lib/dates";
import type { MorningCheckin, PostTrainingCheckin, TrainingSession } from "@/lib/types";

/**
 * Coach-facing athlete status, derived from real data and existing signals.
 *
 * Two independent axes are kept separate everywhere:
 * - athlete state (scores, trends, pain, symptoms)
 * - data quality (today's check-in present, observation count, pending
 *   post-training check-ins)
 *
 * Priority order — a red flag is never masked by a high score or by missing
 * data, and "no data" is never reported as good or bad condition:
 *
 *   needs_check   — open priority alert OR acute red flags in latest data
 *   declining     — verified deviation below personal baseline, a sustained
 *                   below-norm trend, or an open decline-type alert
 *   no_today      — today's state is unknown (no morning check-in)
 *   insufficient  — personal norm cannot be computed yet (< MIN observations)
 *   ok            — fresh data exists and no active rule produced a signal
 *                   (not a medical clearance — just "no flags")
 */
export type AthleteStatus = "needs_check" | "declining" | "no_today" | "insufficient" | "ok";

/** Lower = shown first in priority sorting. */
export const STATUS_ORDER: Record<AthleteStatus, number> = {
  needs_check: 0,
  declining: 1,
  no_today: 2,
  insufficient: 3,
  ok: 4,
};

/** Alert rules that describe a worsening athlete state (not pure load data). */
export const DECLINE_RULES = new Set([
  "readiness_drop",
  "sustained_decline",
  "load_with_decline",
  "repeated_fatigue",
  "joint_pain",
]);

/** True when a morning check-in carries acute red-flag data. */
export function acuteMorningFlags(c: MorningCheckin | null | undefined): boolean {
  if (!c) return false;
  return (
    c.pain_status === "acute_instability" ||
    c.swelling === true ||
    c.movement_limitation === true ||
    (c.pain_severity ?? 0) >= 7 ||
    !!c.symptoms?.trim()
  );
}

/** Post-training check-ins carry pain status only — acute instability counts. */
export function acutePostFlags(p: PostTrainingCheckin | null | undefined): boolean {
  return p?.pain_status === "acute_instability";
}

export interface StatusInput {
  hasPrioritySignal: boolean;
  hasDeclineAlert: boolean;
  todayCheckin: MorningCheckin | null;
  todayScore: number | null;
  baseline: Baseline | null;
  observations: number;
}

export function athleteStatus(i: StatusInput): AthleteStatus {
  if (i.hasPrioritySignal) return "needs_check";
  // A decline conclusion requires either an existing decline alert or a real
  // today score below the personal norm — never inferred from missing data.
  const belowNorm =
    i.baseline !== null &&
    i.todayScore !== null &&
    ((i.baseline.sd > 0 && i.todayScore < i.baseline.avg - i.baseline.sd) ||
      i.todayScore <= i.baseline.avg - 15);
  if (i.hasDeclineAlert || belowNorm) return "declining";
  if (i.todayCheckin === null) return "no_today";
  if (i.observations < MIN_BASELINE_OBSERVATIONS) return "insufficient";
  return "ok";
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function ageInDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Sum of session loads whose local date falls inside [from, to] inclusive. */
export function loadInRange(
  sessions: TrainingSession[],
  tz: string,
  from: string,
  to: string,
): number {
  return sessions
    .filter((s) => {
      const d = localDate(new Date(s.started_at), tz);
      return d >= from && d <= to;
    })
    .reduce((a, s) => a + s.session_load, 0);
}

/**
 * Registered sessions that ended more than `graceMinutes` ago and still have
 * no post-training check-in. Absence of a session record is NOT treated as
 * zero load — this only counts actually registered trainings.
 */
export function pendingPostCheckins(
  sessions: TrainingSession[],
  posts: PostTrainingCheckin[],
  now: Date,
  graceMinutes = 60,
): TrainingSession[] {
  const answered = new Set(posts.map((p) => p.training_session_id));
  const cutoff = now.getTime() - graceMinutes * 60_000;
  return sessions.filter(
    (s) => !answered.has(s.id) && Date.parse(s.started_at) + s.duration_minutes * 60_000 < cutoff,
  );
}
