import { plannedForDate, type PlanOverride, type ScheduleInput } from "@/lib/load";
import type { AttendanceStatus } from "@/lib/types";

/**
 * Effective attendance for one day: an explicit staff mark wins;
 * a logged training session implies "present".
 */
export function effectiveAttendance(
  date: string,
  marks: Map<string, AttendanceStatus>,
  sessionDates: Set<string>,
): AttendanceStatus | null {
  return marks.get(date) ?? (sessionDates.has(date) ? "present" : null);
}

export interface AttendanceSummary {
  /** Days the group schedule says a session was due. */
  scheduled: number;
  /** Present (explicit mark or a logged session). */
  attended: number;
  absent: number;
  excused: number;
  /** Scheduled days with neither a mark nor a session. */
  unmarked: number;
  /** attended / scheduled in %, null when nothing was scheduled. */
  rate: number | null;
}

export function attendanceSummary(
  days: string[],
  schedules: ScheduleInput[],
  overrides: PlanOverride[],
  sessionDates: Set<string>,
  marks: Map<string, AttendanceStatus>,
): AttendanceSummary {
  const sched = days.filter((d) => plannedForDate(d, schedules, overrides).scheduled);
  const s: AttendanceSummary = {
    scheduled: sched.length,
    attended: 0,
    absent: 0,
    excused: 0,
    unmarked: 0,
    rate: null,
  };
  for (const d of sched) {
    const st = effectiveAttendance(d, marks, sessionDates);
    if (st === "present") s.attended++;
    else if (st === "absent") s.absent++;
    else if (st === "excused") s.excused++;
    else s.unmarked++;
  }
  if (sched.length > 0) s.rate = Math.round((s.attended / sched.length) * 100);
  return s;
}
