import { describe, expect, it } from "vitest";
import {
  acwrEwma,
  analyzeLoadWave,
  dailyLoads,
  ewma,
  loadCoverage,
  monotony,
  planOverrunStreak,
  strain,
  weekdayOf,
} from "@/lib/load";

describe("weekdayOf", () => {
  it("returns Sunday-first weekday", () => {
    expect(weekdayOf("2026-10-25")).toBe(0); // Sunday
    expect(weekdayOf("2026-10-26")).toBe(1); // Monday
  });
});

describe("dailyLoads", () => {
  const dates = ["2026-10-25", "2026-10-26", "2026-10-27"];
  const schedules = [
    { weekday: 1, planned_minutes: 90, planned_rpe: 5 }, // Monday
  ];

  it("sums rpe x minutes per day and fills rest days with 0", () => {
    const out = dailyLoads(dates, [
      { date: "2026-10-26", rpe: 6, minutes: 90 },
      { date: "2026-10-26", rpe: 4, minutes: 60 }, // second session same day
    ], schedules);
    expect(out[0]).toMatchObject({ scheduled: false, hasData: false, load: 0, planned: null });
    expect(out[1]).toMatchObject({ scheduled: true, hasData: true, load: 540 + 240, planned: 450 });
    expect(out[2].load).toBe(0);
  });

  it("ignores sessions without rpe/minutes (marker rows)", () => {
    const out = dailyLoads(["2026-10-26"], [
      { date: "2026-10-26", rpe: null, minutes: null },
    ], schedules);
    expect(out[0]).toMatchObject({ load: 0, hasData: false, planned: 450 });
  });

  it("keeps a scheduled day without plan as planned=null", () => {
    const out = dailyLoads(["2026-10-26"], [], [
      { weekday: 1, planned_minutes: null, planned_rpe: null },
    ]);
    expect(out[0].scheduled).toBe(true);
    expect(out[0].planned).toBeNull();
  });

  it("applies a per-date override: changed values replace the template", () => {
    const out = dailyLoads(["2026-10-26"], [], schedules, [
      { plan_date: "2026-10-26", cancelled: false, planned_minutes: 60, planned_rpe: 8 },
    ]);
    expect(out[0]).toMatchObject({ scheduled: true, planned: 480 });
  });

  it("applies a cancelled override: scheduled day becomes a rest day", () => {
    const out = dailyLoads(["2026-10-26"], [], schedules, [
      { plan_date: "2026-10-26", cancelled: true, planned_minutes: null, planned_rpe: null },
    ]);
    expect(out[0]).toMatchObject({ scheduled: false, planned: null });
  });

  it("applies an added-day override on a non-template weekday", () => {
    const out = dailyLoads(["2026-10-25"], [], schedules, [
      { plan_date: "2026-10-25", cancelled: false, planned_minutes: 45, planned_rpe: 4 },
    ]);
    expect(out[0]).toMatchObject({ scheduled: true, planned: 180 });
  });
});

describe("ewma", () => {
  it("converges to a constant input", () => {
    const out = ewma(Array(60).fill(100), 2 / 8);
    expect(out.at(-1)).toBeCloseTo(100, 1);
  });

  it("seeds with the first observation, then weights by lambda", () => {
    const out = ewma([100, 300], 0.5);
    expect(out[0]).toBe(100);
    expect(out[1]).toBe(200);
  });
});

describe("acwrEwma", () => {
  it("returns null below minDays", () => {
    expect(acwrEwma(Array(14).fill(300))).toBeNull();
  });

  it("ratio ≈ 1 on a steady load", () => {
    const r = acwrEwma(Array(30).fill(300));
    expect(r).not.toBeNull();
    expect(r!.ratio).toBeCloseTo(1, 1);
  });

  it("ratio > 1 after a load spike", () => {
    const loads = [...Array(21).fill(300), ...Array(7).fill(900)];
    const r = acwrEwma(loads);
    expect(r!.ratio).toBeGreaterThan(1.5);
  });

  it("ratio < 1 after unloading", () => {
    const loads = [...Array(28).fill(600), ...Array(7).fill(100)];
    const r = acwrEwma(loads);
    expect(r!.ratio).toBeLessThan(0.8);
  });

  it("returns null when chronic load is ~0", () => {
    expect(acwrEwma(Array(30).fill(0))).toBeNull();
  });

  it("returns null when a single session sits in a long zero window", () => {
    // Regression: 41-day window with training only yesterday+today must not
    // produce an ACWR spike — history counts from the first non-zero load.
    const loads = [...Array(39).fill(0), 0, 840];
    expect(acwrEwma(loads)).toBeNull();
  });

  it("counts history from the first non-zero load, not the window start", () => {
    const loads = [...Array(20).fill(0), ...Array(25).fill(300)];
    const r = acwrEwma(loads);
    expect(r!.days).toBe(25);
  });
});

describe("monotony / strain", () => {
  it("null on perfectly flat week (SD=0)", () => {
    expect(monotony(Array(7).fill(300))).toBeNull();
    expect(strain(Array(7).fill(300))).toBeNull();
  });

  it("high on near-identical daily load", () => {
    // 6 identical heavy days + one token easy day: no real variation
    const loads = [600, 600, 600, 600, 600, 600, 50];
    expect(monotony(loads)!).toBeGreaterThan(2);
    expect(strain(loads)!).toBeCloseTo(3650 * monotony(loads)!, 6);
  });

  it("low on varied week", () => {
    const loads = [0, 200, 600, 150, 700, 300, 0];
    expect(monotony(loads)!).toBeLessThan(2);
  });
});

describe("dailyLoads — missing data is not a zero", () => {
  const schedules = [{ weekday: 1, planned_minutes: 90, planned_rpe: 5 }];

  it("recorded session without rpe/minutes is 'partial', never zero", () => {
    const out = dailyLoads(["2026-10-26"], [
      { date: "2026-10-26", rpe: null, minutes: null },
    ], schedules);
    expect(out[0].state).toBe("partial");
    expect(out[0].sessions).toBe(1);
    expect(out[0].incomplete).toBe(1);
    expect(out[0].load).toBe(0); // quantified part only — state carries the truth
  });

  it("scheduled day with no record is 'unknown', not rest", () => {
    const out = dailyLoads(["2026-10-26"], [], schedules);
    expect(out[0].state).toBe("unknown");
  });

  it("unscheduled day with no record is 'unscheduled' (assumed rest, unconfirmed)", () => {
    const out = dailyLoads(["2026-10-25"], [], schedules);
    expect(out[0].state).toBe("unscheduled");
  });

  it("cancelled override is a confirmed 'rest'", () => {
    const out = dailyLoads(["2026-10-26"], [], schedules, [
      { plan_date: "2026-10-26", cancelled: true, planned_minutes: null, planned_rpe: null },
    ]);
    expect(out[0].state).toBe("rest");
  });

  it("attendance 'absent' on a scheduled day means rest", () => {
    const out = dailyLoads(["2026-10-26"], [], schedules, [], {
      present: new Set(),
      absent: new Set(["2026-10-26"]),
    });
    expect(out[0].state).toBe("rest");
    expect(out[0].attendance).toBe("absent");
  });

  it("attendance 'present' on a scheduled day without records is 'unknown'", () => {
    const out = dailyLoads(["2026-10-26"], [], schedules, [], {
      present: new Set(["2026-10-26"]),
      absent: new Set(),
    });
    expect(out[0].state).toBe("unknown");
  });

  it("quantified session is 'known'", () => {
    const out = dailyLoads(["2026-10-26"], [
      { date: "2026-10-26", rpe: 6, minutes: 90 },
    ], schedules);
    expect(out[0].state).toBe("known");
    expect(out[0].hasData).toBe(true);
  });
});

describe("loadCoverage", () => {
  const day = (
    state: "known" | "partial" | "unknown" | "rest" | "unscheduled",
    scheduled = true,
  ) => ({
    date: "2026-10-20",
    scheduled,
    load: 0,
    hasData: false,
    planned: null,
    sessions: 0,
    incomplete: 0,
    attendance: "unknown" as const,
    state,
  });

  it("counts only known/confirmed-rest days among relevant ones", () => {
    const cov = loadCoverage([day("known"), day("rest"), day("partial"), day("unknown")]);
    expect(cov).toMatchObject({ known: 2, total: 4, pct: 50, reliable: false });
  });

  it("is reliable at >= 80% resolved with >= 3 training days", () => {
    const cov = loadCoverage([
      day("known"), day("known"), day("known"), day("rest"), day("unknown"),
    ]);
    expect(cov.pct).toBe(80);
    expect(cov.reliable).toBe(true);
  });

  it("audit case: 5 unknown training days among rests is never reliable", () => {
    // 40 days: 5 scheduled-but-unrecorded, the rest plain unscheduled days —
    // assumed rest must not inflate coverage into a confident ACWR.
    const days = [
      ...Array.from({ length: 5 }, () => day("unknown")),
      ...Array.from({ length: 35 }, () => day("unscheduled", false)),
    ];
    const cov = loadCoverage(days);
    expect(cov.reliable).toBe(false);
    expect(cov.knownTrainingDays).toBe(0);
  });

  it("unscheduled days are excluded from the denominator entirely", () => {
    const cov = loadCoverage([day("known"), day("unscheduled", false), day("unscheduled", false)]);
    expect(cov.total).toBe(1); // only the relevant day counts
    expect(cov.pct).toBe(100);
    expect(cov.reliable).toBe(false); // but <3 training days → still unreliable
  });
});

describe("planOverrunStreak", () => {
  const mk = (over: boolean[]): ReturnType<typeof dailyLoads>[number][] =>
    over.map((o, i) => ({
      date: `2026-10-${String(20 + i).padStart(2, "0")}`,
      scheduled: true,
      hasData: true,
      load: o ? 600 : 400,
      planned: 400,
      sessions: 1,
      incomplete: 0,
      attendance: "unknown" as const,
      state: "known" as const,
    }));

  it("counts consecutive overrun days from the end", () => {
    expect(planOverrunStreak(mk([false, true, true, true]), 1.25)).toBe(3);
    expect(planOverrunStreak(mk([true, true, false]), 1.25)).toBe(0);
  });

  it("breaks on missing data", () => {
    const days = mk([true, true]);
    days[1] = { ...days[1], hasData: false, load: 0 };
    expect(planOverrunStreak(days, 1.25)).toBe(0);
  });
});

describe("analyzeLoadWave", () => {
  const mkDays = (vals: number[]) =>
    vals.map((load, i) => ({
      date: `2026-10-${String(10 + i).padStart(2, "0")}`,
      load,
    }));

  it("classifies BWF undulating wave as good with red peaks and green deloads", () => {
    const w = analyzeLoadWave(mkDays([450, 680, 200, 480, 650, 0]));
    expect(w.status).toBe("good");
    expect(w.peaks).toBe(2);
    expect(w.recoveries).toBe(1);
    expect(w.tags.get("2026-10-11")).toBe("peak");
    expect(w.tags.get("2026-10-12")).toBe("recovery");
  });

  it("flags flat monotonous week without deload windows", () => {
    const w = analyzeLoadWave(mkDays([500, 510, 500, 520, 500]));
    expect(w.status).toBe("monotonous");
    expect(w.recoveries).toBe(0);
  });
});
