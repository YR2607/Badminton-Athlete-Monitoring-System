import { describe, expect, it } from "vitest";
import {
  acwrEwma,
  analyzeLoadWave,
  dailyLoads,
  ewma,
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
    expect(acwrEwma(Array(20).fill(300))).toBeNull();
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

describe("planOverrunStreak", () => {
  const mk = (over: boolean[]): ReturnType<typeof dailyLoads>[number][] =>
    over.map((o, i) => ({
      date: `2026-10-${String(20 + i).padStart(2, "0")}`,
      scheduled: true,
      hasData: true,
      load: o ? 600 : 400,
      planned: 400,
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
