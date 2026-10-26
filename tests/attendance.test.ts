import { describe, expect, it } from "vitest";
import { attendanceSummary, effectiveAttendance } from "@/lib/attendance";
import { weekdayOf, type PlanOverride, type ScheduleInput } from "@/lib/load";
import { dateRange } from "@/lib/dates";
import type { AttendanceStatus } from "@/lib/types";

const DAYS = dateRange("2026-10-19", "2026-10-25"); // Mon–Sun
// Scheduled every Mon/Wed/Fri in the window.
const SCHED: ScheduleInput[] = [1, 3, 5].map((weekday) => ({
  weekday,
  planned_minutes: 90,
  planned_rpe: 6,
}));
const SCHEDULED_DAYS = DAYS.filter((d) => [1, 3, 5].includes(weekdayOf(d))); // 3 days

function marks(...entries: [string, AttendanceStatus][]) {
  return new Map<string, AttendanceStatus>(entries);
}

describe("attendanceSummary", () => {
  it("counts logged sessions as present without any mark", () => {
    const sessions = new Set([SCHEDULED_DAYS[0]]);
    const s = attendanceSummary(DAYS, SCHED, [], sessions, marks());
    expect(s.scheduled).toBe(3);
    expect(s.attended).toBe(1);
    expect(s.unmarked).toBe(2);
    expect(s.rate).toBe(33);
  });

  it("explicit marks win over derived presence and absence", () => {
    const sessions = new Set([SCHEDULED_DAYS[0]]);
    const m = marks(
      [SCHEDULED_DAYS[0], "absent"], // coach overrides: mark wins over session
      [SCHEDULED_DAYS[1], "present"],
      [SCHEDULED_DAYS[2], "excused"],
    );
    const s = attendanceSummary(DAYS, SCHED, [], sessions, m);
    expect(s.attended).toBe(1);
    expect(s.absent).toBe(1);
    expect(s.excused).toBe(1);
    expect(s.unmarked).toBe(0);
  });

  it("cancelled overrides remove the day from scheduled", () => {
    const ov: PlanOverride[] = [
      { plan_date: SCHEDULED_DAYS[1], cancelled: true, planned_minutes: null, planned_rpe: null },
    ];
    const s = attendanceSummary(DAYS, SCHED, ov, new Set(), marks());
    expect(s.scheduled).toBe(2);
  });

  it("added override creates an extra scheduled day", () => {
    const extra = DAYS.find((d) => !SCHEDULED_DAYS.includes(d))!;
    const ov: PlanOverride[] = [
      { plan_date: extra, cancelled: false, planned_minutes: 60, planned_rpe: 5 },
    ];
    const s = attendanceSummary(DAYS, SCHED, ov, new Set([extra]), marks());
    expect(s.scheduled).toBe(4);
    expect(s.attended).toBe(1);
  });

  it("rate is null when nothing was scheduled", () => {
    const s = attendanceSummary(DAYS, [], [], new Set(), marks());
    expect(s.scheduled).toBe(0);
    expect(s.rate).toBeNull();
  });

  it("effectiveAttendance prefers the mark, then session, then null", () => {
    const d = "2026-10-19";
    expect(effectiveAttendance(d, marks([d, "excused"]), new Set([d]))).toBe("excused");
    expect(effectiveAttendance(d, marks(), new Set([d]))).toBe("present");
    expect(effectiveAttendance(d, marks(), new Set())).toBeNull();
  });
});
