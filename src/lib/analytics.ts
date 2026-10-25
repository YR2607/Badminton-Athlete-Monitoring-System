import type { Alert, MorningCheckin, PostTrainingCheckin, TrainingSession } from "@/lib/types";
import { dailyConditionSeries } from "@/lib/readiness";
import { dayStatuses } from "@/lib/checkins";
import { localDate } from "@/lib/dates";

/**
 * Period analytics: check-in completion and aggregated wellbeing stats.
 * Pure functions over fetched rows — unit-tested, no DB access.
 */

export interface DayCell {
  date: string; // YYYY-MM-DD
  filled: boolean; // morning check-in submitted
  hasPain: boolean;
  evening: boolean; // post-training check-in submitted for that day
  hadSession: boolean; // a training session was recorded that day
}

export interface AthletePeriodStats {
  athleteId: string;
  filled: number; // check-ins submitted in range
  expected: number; // days in range
  rate: number; // 0..100
  avgSleep: number | null;
  avgRecovery: number | null;
  avgFatigue: number | null;
  avgSoreness: number | null;
  avgStress: number | null;
  avgMood: number | null;
  avgReadiness: number | null;
  sessions: number;
  painDays: number;
  alerts: number;
  cells: DayCell[]; // per-day fill status, ascending
}

export interface PeriodSummary {
  athletes: number;
  checkinsFilled: number;
  checkinsExpected: number;
  fillRate: number; // 0..100
  sessions: number;
  avgReadiness: number | null;
  alerts: number;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export function athleteStats(
  athleteId: string,
  days: string[],
  checkins: MorningCheckin[],
  sessions: TrainingSession[],
  alerts: Alert[],
  posts: { date: string; post: Pick<PostTrainingCheckin, "overall_feeling" | "leg_fatigue" | "arm_shoulder_fatigue"> & { pain_status?: string } }[] = [],
  tz?: string,
): AthletePeriodStats {
  const sessionDates = sessions.map((s) =>
    tz ? localDate(new Date(s.started_at), tz) : s.started_at.slice(0, 10),
  );
  const postPainDates = new Set(
    posts
      .filter((p) => p.post.pain_status && p.post.pain_status !== "none")
      .map((p) => p.date),
  );
  const cells: DayCell[] = dayStatuses({
    days,
    checkins,
    postEntries: posts,
    sessionDates,
  }).map((d) => ({
    date: d.date,
    filled: d.morning !== null,
    hasPain: d.hasPain || postPainDates.has(d.date),
    evening: d.evening !== null,
    hadSession: d.hadSession,
  }));

  const scores = dailyConditionSeries(checkins, posts);

  // Fill rate counts BOTH questionnaires: morning every day, evening on
  // days a session was recorded — a 100% rate requires both.
  const sessionDays = cells.filter((c) => c.hadSession).length;
  const eveningFilled = cells.filter((c) => c.evening).length;
  const expectedItems = days.length + sessionDays;
  const filledItems = checkins.length + eveningFilled;

  return {
    athleteId,
    filled: filledItems,
    expected: expectedItems,
    rate: expectedItems ? Math.round((filledItems / expectedItems) * 100) : 0,
    avgSleep: avg(checkins.map((c) => c.sleep_score)),
    avgRecovery: avg(checkins.map((c) => c.recovery_score)),
    avgFatigue: avg(checkins.map((c) => c.fatigue_score)),
    avgSoreness: avg(checkins.map((c) => c.muscle_soreness_score)),
    avgStress: avg(checkins.map((c) => c.stress_score)),
    avgMood: avg(checkins.map((c) => c.mood_score)),
    avgReadiness: avg(scores.map((s) => s.score)),
    sessions: sessions.length,
    painDays: cells.filter((c) => c.hasPain).length,
    alerts: alerts.length,
    cells,
  };
}

export function periodSummary(stats: AthletePeriodStats[]): PeriodSummary {
  const filled = stats.reduce((a, s) => a + s.filled, 0);
  const expected = stats.reduce((a, s) => a + s.expected, 0);
  return {
    athletes: stats.length,
    checkinsFilled: filled,
    checkinsExpected: expected,
    fillRate: expected ? Math.round((filled / expected) * 100) : 0,
    sessions: stats.reduce((a, s) => a + s.sessions, 0),
    avgReadiness: avg(stats.flatMap((s) => (s.avgReadiness !== null ? [s.avgReadiness] : []))),
    alerts: stats.reduce((a, s) => a + s.alerts, 0),
  };
}

/** Delta of a metric vs the previous equal-length period (null when no data). */
export function delta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return Math.round((cur - prev) * 10) / 10;
}
