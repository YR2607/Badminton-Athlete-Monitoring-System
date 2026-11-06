import type { Baseline } from "@/lib/readiness";
import type { AthleteStatus } from "@/lib/athlete-status";

/**
 * Coach "who needs attention today" classifier — the SINGLE place that
 * assigns every athlete to exactly one dashboard category. Pure and
 * unit-tested; UI must not re-implement this logic.
 *
 * Categories (priority order, mutually exclusive):
 *
 *   check   — CHECK BEFORE TRAINING: acute red flags or an open priority
 *             alert. Never masked by good scores or missing data.
 *   review  — REVIEW: meaningful deviation below the personal norm or an
 *             open decline-type alert. A single below-norm day is shown
 *             as "one day below norm — verify", not a confirmed decline.
 *   missing — MISSING DATA: today's state is unknown (no morning
 *             check-in) or there is not enough history for a personal
 *             norm. "No data" is NEVER reported as a bad state.
 *   none    — NO CURRENT SIGNALS: fresh data exists, nothing fired.
 *             NOT a medical clearance.
 */
export type PriorityCategory = "check" | "review" | "missing" | "none";

export const PRIORITY_ORDER: Record<PriorityCategory, number> = {
  check: 0,
  review: 1,
  missing: 2,
  none: 3,
};

export interface PriorityInput {
  status: AthleteStatus;
  /** Acute red flags / open priority alert (already resolved upstream). */
  acuteSignal: boolean;
  /** Open decline-type alert (sustained, rule-verified worsening). */
  hasDeclineAlert: boolean;
  /** Today below the personal norm (single-day deviation). */
  belowNorm: boolean;
  /** Morning check-in exists today. */
  hasTodayCheckin: boolean;
  /** Registered sessions ended >1h ago without a post check-in. */
  pendingPostCount: number;
  /** Days since the last morning check-in; null when never filled. */
  lastCheckinAgeDays: number | null;
  /** Days backing the personal norm; 0 when no norm exists. */
  normDays: number;
  /** Scheduled session yesterday that wasn't registered; null = no schedule. */
  scheduledMissedYesterday: boolean | null;
  /** Non-acute pain reported in the last couple of days. */
  hasPain: boolean;
}

export interface PriorityResult {
  category: PriorityCategory;
  /** Machine-readable reason for the card's "why" line. */
  reason:
    | "acute_flags"
    | "priority_alert"
    | "decline_alert"
    | "below_norm"
    | "pain_reported"
    | "no_checkin_today"
    | "stale_checkin"
    | "pending_post"
    | "norm_not_formed"
    | "missed_session"
    | "no_signals";
}

export function classifyAthlete(i: PriorityInput): PriorityResult {
  // 1 — CHECK BEFORE TRAINING
  if (i.status === "needs_check" || i.acuteSignal) {
    return { category: "check", reason: i.acuteSignal ? "acute_flags" : "priority_alert" };
  }

  // 2 — REVIEW: verified decline alert, or today's score below the norm.
  if (i.hasDeclineAlert) return { category: "review", reason: "decline_alert" };
  if (i.status === "declining" || i.belowNorm) {
    return { category: "review", reason: "below_norm" };
  }
  if (i.hasPain) return { category: "review", reason: "pain_reported" };

  // 3 — MISSING DATA: today's state can't be judged.
  if (!i.hasTodayCheckin) {
    if (i.lastCheckinAgeDays === null) {
      return { category: "missing", reason: "no_checkin_today" };
    }
    return { category: "missing", reason: i.lastCheckinAgeDays >= 2 ? "stale_checkin" : "no_checkin_today" };
  }
  if (i.status === "insufficient" || i.normDays === 0) {
    return { category: "missing", reason: "norm_not_formed" };
  }
  if (i.pendingPostCount > 0) {
    return { category: "missing", reason: "pending_post" };
  }
  if (i.scheduledMissedYesterday === true) {
    return { category: "missing", reason: "missed_session" };
  }

  // 4 — NO CURRENT SIGNALS
  return { category: "none", reason: "no_signals" };
}

/** Convert the resolved norm/baseline + today score to a PriorityInput flag. */
export function belowNormFlag(
  todayScore: number | null,
  baseline: Baseline | null,
): boolean {
  return (
    baseline !== null &&
    todayScore !== null &&
    ((baseline.sd > 0 && todayScore < baseline.avg - baseline.sd) ||
      todayScore <= baseline.avg - 15)
  );
}
