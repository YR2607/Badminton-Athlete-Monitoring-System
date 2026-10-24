// Training-load math (server-side, deterministic, unit-tested).
//
// - daily_load: sum of session RPE x minutes per athlete-local day (AU).
//   Days without a reported session are 0 for the math, but `hasData`
//   distinguishes "rest day / missed entry" from a real 0.
// - ACWR by EWMA (Williams et al. 2017): lambda = 2/(days+1) for the
//   7-day acute and 28-day chronic windows. Needs >= 21 days of history.
// - Monotony (Foster): mean / SD of the last 7 daily loads.
//   Strain: weekly load sum x monotony.

export interface DayLoad {
  date: string; // YYYY-MM-DD, athlete-local
  scheduled: boolean; // group had a session on the schedule that weekday
  load: number; // actual AU (0 when no session reported)
  hasData: boolean; // at least one session reported for the day
  planned: number | null; // planned AU from schedule (planned_rpe x planned_minutes)
}

export interface SessionInput {
  date: string; // athlete-local date of the session
  rpe: number | null; // CR-10
  minutes: number | null;
}

export interface ScheduleInput {
  weekday: number; // 0-6, Sunday-first (matches DB)
  planned_minutes: number | null;
  planned_rpe: number | null;
}

/** Calendar weekday of a YYYY-MM-DD string — timezone-independent. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/**
 * Day-by-day load for a date range. A day counts as `scheduled` when any
 * active schedule row matches its weekday; `planned` sums planned loads.
 */
export function dailyLoads(
  dates: string[],
  sessions: SessionInput[],
  schedules: ScheduleInput[],
): DayLoad[] {
  const byDate = new Map<string, number>();
  for (const s of sessions) {
    if (s.rpe == null || s.minutes == null) continue;
    byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.rpe * s.minutes);
  }
  return dates.map((date) => {
    const wd = weekdayOf(date);
    const rows = schedules.filter((s) => s.weekday === wd);
    const plannedParts = rows
      .map((s) =>
        s.planned_minutes != null && s.planned_rpe != null
          ? s.planned_minutes * s.planned_rpe
          : null,
      )
      .filter((v): v is number => v !== null);
    return {
      date,
      scheduled: rows.length > 0,
      hasData: byDate.has(date),
      load: byDate.get(date) ?? 0,
      planned: plannedParts.length > 0 ? plannedParts.reduce((a, b) => a + b, 0) : null,
    };
  });
}

/**
 * EWMA series. Seeded with the first observation (not 0) so a steady-load
 * series reads ratio ≈ 1 immediately instead of drifting up over weeks.
 * Missing/negative loads are clamped to 0.
 */
export function ewma(values: number[], lambda: number): number[] {
  let prev: number | null = null;
  return values.map((v) => {
    const x = Number.isFinite(v) && v > 0 ? v : 0;
    prev = prev === null ? x : lambda * x + (1 - lambda) * prev;
    return prev;
  });
}

export interface AcwrResult {
  acute: number;
  chronic: number;
  ratio: number;
  days: number;
}

/**
 * EWMA acute:chronic workload ratio on the LAST element of `loads`
 * (in chronological order). Returns null with < `minDays` of history
 * or when chronic load is ~0 (ratio is meaningless at zero denominator).
 */
export function acwrEwma(loads: number[], minDays = 21): AcwrResult | null {
  if (loads.length < minDays) return null;
  const lAcute = 2 / (7 + 1);
  const lChronic = 2 / (28 + 1);
  const acute = ewma(loads, lAcute).at(-1)!;
  const chronic = ewma(loads, lChronic).at(-1)!;
  if (chronic < 1) return null; // practically no training — ratio would explode
  return { acute, chronic, ratio: acute / chronic, days: loads.length };
}

/**
 * Per-day ACWR series for charts: one ratio per day starting from `minDays`
 * of history; earlier positions are null. Ratio < ~0 while chronic ≈ 0 is
 * suppressed as meaningless.
 */
export function acwrSeries(loads: number[], minDays = 21): (number | null)[] {
  const lAcute = 2 / (7 + 1);
  const lChronic = 2 / (28 + 1);
  const acute = ewma(loads, lAcute);
  const chronic = ewma(loads, lChronic);
  return loads.map((_, i) => {
    if (i + 1 < minDays || chronic[i] < 1) return null;
    return acute[i] / chronic[i];
  });
}

/** Foster monotony for a 7-day window: mean / population SD. Null if SD ~ 0. */
export function monotony(loads7: number[]): number | null {
  if (loads7.length < 7) return null;
  const mean = loads7.reduce((a, b) => a + b, 0) / loads7.length;
  const variance =
    loads7.reduce((a, b) => a + (b - mean) * (b - mean), 0) / loads7.length;
  const sd = Math.sqrt(variance);
  if (sd < 1e-9) return null;
  return mean / sd;
}

/** Weekly strain = weekly load sum x monotony. Null if monotony is null. */
export function strain(loads7: number[]): number | null {
  const m = monotony(loads7);
  if (m === null) return null;
  return loads7.reduce((a, b) => a + b, 0) * m;
}

/**
 * Longest current streak of days where actual load exceeded planned load by
 * `ratio` (e.g. 1.25). Only days with both data and a plan count; the streak
 * breaks on rest days and in-plan days alike.
 */
export function planOverrunStreak(days: DayLoad[], ratio: number): number {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (!d.hasData || d.planned == null || d.planned <= 0) break;
    if (d.load > d.planned * ratio) streak += 1;
    else break;
  }
  return streak;
}
