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
  load: number; // quantified AU only — never conflated with "unknown"
  hasData: boolean; // at least one session with rpe+minutes reported
  planned: number | null; // planned AU from schedule (planned_rpe x planned_minutes)
  /** Sessions recorded that day (any, incl. missing rpe/minutes). */
  sessions: number;
  /** Sessions missing rpe or duration — load exists but is unquantified. */
  incomplete: number;
  /** Attendance mark for the day, when provided. */
  attendance: "present" | "absent" | "unknown";
  /**
   * What `load` actually means for the day:
   * - "known":   recorded sessions all have rpe+minutes
   * - "partial": sessions recorded but some lack rpe/minutes — real load unknown
   * - "unknown": training plausibly happened (scheduled or attended) but
   *              nothing usable was recorded — must NOT be treated as 0
   * - "rest":    genuinely no club training (unscheduled, or marked absent)
   */
  state: "known" | "partial" | "unknown" | "rest";
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

/** Per-date plan override (session_plan_overrides row). */
export interface PlanOverride {
  plan_date: string; // YYYY-MM-DD
  cancelled: boolean;
  start_time?: string | null; // "HH:MM" — only meaningful for added sessions
  planned_minutes: number | null;
  planned_rpe: number | null;
}

export interface EffectivePlan {
  scheduled: boolean;
  planned: number | null; // planned AU
  planned_minutes: number | null;
  planned_rpe: number | null;
}

/**
 * Resolve the plan for one date: a matching override wins over the weekly
 * template; a cancelled override means no session that day.
 */
export function plannedForDate(
  date: string,
  schedules: ScheduleInput[],
  overrides?: PlanOverride[] | Map<string, PlanOverride>,
): EffectivePlan {
  const list = overrides instanceof Map ? [...overrides.values()] : (overrides ?? []);
  const o = list.find((x) => x.plan_date === date);
  if (o) {
    if (o.cancelled) {
      return { scheduled: false, planned: null, planned_minutes: null, planned_rpe: null };
    }
    const planned =
      o.planned_minutes != null && o.planned_rpe != null
        ? o.planned_minutes * o.planned_rpe
        : null;
    return {
      scheduled: true,
      planned,
      planned_minutes: o.planned_minutes,
      planned_rpe: o.planned_rpe,
    };
  }
  const wd = weekdayOf(date);
  const rows = schedules.filter((s) => s.weekday === wd);
  const parts = rows
    .map((s) =>
      s.planned_minutes != null && s.planned_rpe != null
        ? s.planned_minutes * s.planned_rpe
        : null,
    )
    .filter((v): v is number => v !== null);
  return {
    scheduled: rows.length > 0,
    planned: parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null,
    planned_minutes: rows.find((s) => s.planned_minutes != null)?.planned_minutes ?? null,
    planned_rpe: rows.find((s) => s.planned_rpe != null)?.planned_rpe ?? null,
  };
}

/** Attendance marks per athlete-local date; "excused" counts as absent. */
export interface AttendanceMarks {
  present: ReadonlySet<string>;
  absent: ReadonlySet<string>;
}

/**
 * Day-by-day load for a date range. A day counts as `scheduled` when any
 * active schedule row matches its weekday (or an override adds one);
 * `planned` sums planned loads.
 *
 * Sessions missing rpe or minutes are counted separately (`incomplete`)
 * and never add to `load` — a recorded-but-unquantified session is
 * "partial", not zero. With no sessions at all the day is "unknown" when
 * training plausibly happened (scheduled, or attendance says present) and
 * "rest" otherwise — so "missing data" never silently reads as "rest".
 */
export function dailyLoads(
  dates: string[],
  sessions: SessionInput[],
  schedules: ScheduleInput[],
  overrides?: PlanOverride[],
  attendance?: AttendanceMarks,
): DayLoad[] {
  const ovByDate = new Map((overrides ?? []).map((o) => [o.plan_date, o]));
  const byDate = new Map<string, { load: number; sessions: number; incomplete: number }>();
  for (const s of sessions) {
    const e = byDate.get(s.date) ?? { load: 0, sessions: 0, incomplete: 0 };
    e.sessions += 1;
    if (s.rpe == null || s.minutes == null) e.incomplete += 1;
    else e.load += s.rpe * s.minutes;
    byDate.set(s.date, e);
  }
  return dates.map((date) => {
    const plan = plannedForDate(date, schedules, ovByDate);
    const e = byDate.get(date);
    const sessionsN = e?.sessions ?? 0;
    const incomplete = e?.incomplete ?? 0;
    const att = attendance
      ? attendance.present.has(date)
        ? "present"
        : attendance.absent.has(date)
          ? "absent"
          : "unknown"
      : "unknown";
    const state: DayLoad["state"] =
      sessionsN > 0
        ? incomplete > 0
          ? "partial"
          : "known"
        : att === "absent"
          ? "rest"
          : att === "present" || plan.scheduled
            ? "unknown"
            : "rest";
    return {
      date,
      scheduled: plan.scheduled,
      hasData: sessionsN > 0 && incomplete < sessionsN,
      load: e?.load ?? 0,
      planned: plan.planned,
      sessions: sessionsN,
      incomplete,
      attendance: att,
      state,
    };
  });
}

export interface LoadCoverage {
  /** Days whose load value is trustworthy (known or genuine rest). */
  known: number;
  total: number;
  pct: number;
  /** Enough coverage to trust ACWR/monotony conclusions (>= 80% known). */
  reliable: boolean;
}

/** Share of days in the window where load is actually known vs missing. */
export function loadCoverage(days: DayLoad[]): LoadCoverage {
  const known = days.filter((d) => d.state === "known" || d.state === "rest").length;
  const pct = days.length ? Math.round((known / days.length) * 100) : 0;
  return { known, total: days.length, pct, reliable: pct >= 80 };
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
  // History = days since the first non-zero load, not the window length —
  // otherwise a single session after weeks of zeros yields a fake spike.
  const firstIdx = loads.findIndex((l) => l > 0);
  const days = firstIdx === -1 ? 0 : loads.length - firstIdx;
  if (days < minDays) return null;
  const lAcute = 2 / (7 + 1);
  const lChronic = 2 / (28 + 1);
  const acute = ewma(loads, lAcute).at(-1)!;
  const chronic = ewma(loads, lChronic).at(-1)!;
  if (chronic < 1) return null; // practically no training — ratio would explode
  return { acute, chronic, ratio: acute / chronic, days };
}

/**
 * Per-day ACWR series for charts: one ratio per day starting from `minDays`
 * of history; earlier positions are null. Ratio < ~0 while chronic ≈ 0 is
 * suppressed as meaningless.
 */
export function acwrSeries(loads: number[], minDays = 21): (number | null)[] {
  const firstIdx = loads.findIndex((l) => l > 0);
  const lAcute = 2 / (7 + 1);
  const lChronic = 2 / (28 + 1);
  const acute = ewma(loads, lAcute);
  const chronic = ewma(loads, lChronic);
  return loads.map((_, i) => {
    if (firstIdx === -1 || i - firstIdx + 1 < minDays || chronic[i] < 1) return null;
    return acute[i] / chronic[i];
  });
}

export type LoadWaveTag = "peak" | "recovery" | "base";

export interface LoadWaveSummary {
  tags: Map<string, LoadWaveTag>;
  status: "good" | "monotonous" | "insufficient";
  peaks: number;
  recoveries: number;
  maxHardStreak: number;
  meanActive: number;
}

/**
 * BWF undulating-load classifier (Cristian Luque Manjón, Paris 2024):
 * classifies each active day as a red shock peak, green deload valley, or
 * blue base day relative to the athlete/group mean active load, and flags
 * monotonous "flat fence" blocks lacking deload windows.
 */
export function analyzeLoadWave(
  days: { date: string; load: number }[],
): LoadWaveSummary {
  const tags = new Map<string, LoadWaveTag>();
  const active = days.filter((d) => d.load > 0);
  if (active.length < 3) {
    return {
      tags,
      status: "insufficient",
      peaks: 0,
      recoveries: 0,
      maxHardStreak: 0,
      meanActive: 0,
    };
  }
  const meanActive = Math.round(
    active.reduce((acc, d) => acc + d.load, 0) / active.length,
  );
  const peakThreshold = Math.max(360, Math.round(meanActive * 1.22));
  const recoveryThreshold = Math.max(100, Math.round(meanActive * 0.68));

  let peaks = 0;
  let recoveries = 0;
  let streak = 0;
  let maxHardStreak = 0;

  for (const d of days) {
    if (d.load <= 0) {
      streak = 0;
      continue;
    }
    if (d.load >= peakThreshold) {
      tags.set(d.date, "peak");
      peaks++;
      streak++;
    } else if (d.load <= recoveryThreshold) {
      tags.set(d.date, "recovery");
      recoveries++;
      streak = 0;
    } else {
      tags.set(d.date, "base");
      if (d.load >= meanActive * 0.85) streak++;
      else streak = 0;
    }
    if (streak > maxHardStreak) maxHardStreak = streak;
  }

  // Monotonous when:
  //  - 4+ active days have no recovery/deload window and either 4+ hard days
  //    in a row or all sessions sit in a flat band (peaks=0 && recoveries=0).
  const isMonotonous =
    maxHardStreak >= 4 ||
    (active.length >= 4 && recoveries === 0);

  return {
    tags,
    status: isMonotonous ? "monotonous" : "good",
    peaks,
    recoveries,
    maxHardStreak,
    meanActive,
  };
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
