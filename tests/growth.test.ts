import { describe, expect, it } from "vitest";
import {
  decimalAge,
  tableAge,
  khamisRoche,
  growthVelocity,
  maturationCategory,
} from "@/lib/growth";

describe("decimalAge / tableAge", () => {
  it("computes decimal years between dates", () => {
    expect(decimalAge("2014-01-01", "2024-01-01")).toBeCloseTo(10, 1);
  });

  it("rounds to half-years and respects the 4.0–17.5 table range", () => {
    expect(tableAge(10.24)).toBe(10.0);
    expect(tableAge(10.26)).toBe(10.5);
    expect(tableAge(3.4)).toBeNull();
    expect(tableAge(18)).toBeNull();
  });
});

describe("khamisRoche", () => {
  // Control values computed from the matuR coefficient table by hand:
  // male age 10: -11.038 + 55.118*0.97135 - 70.548*0.003998 + 66.929*0.45932
  it("predicts adult height for a 10y boy (verified vs matuR coefficients)", () => {
    const r = khamisRoche("male", 140, 32, 165, 175, 10.0);
    expect(r).not.toBeNull();
    expect(r!.pahCm).toBeCloseTo(185.3, 0);
    expect(r!.pctPah).toBeCloseTo(75.6, 0);
  });

  // female age 12: 4.84365 + 59.055*0.64452 - 88.185*0.004894 + 64.961*0.39490
  it("predicts adult height for a 12y girl", () => {
    const r = khamisRoche("female", 150, 40, 160, 170, 12.0);
    expect(r!.pahCm).toBeCloseTo(173.0, 0);
  });

  it("returns null outside the table age range", () => {
    expect(khamisRoche("male", 140, 32, 165, 175, 3.2)).toBeNull();
    expect(khamisRoche("male", 180, 70, 165, 175, 18)).toBeNull();
  });
});

describe("growthVelocity", () => {
  it("cm/year between the two latest measurements", () => {
    const v = growthVelocity([
      { measured_on: "2026-01-01", height_cm: 140, weight_kg: 32 },
      { measured_on: "2026-07-01", height_cm: 144.5, weight_kg: 33 },
    ]);
    expect(v).toBeCloseTo(9, 0); // 4.5cm in ~0.5y
  });

  it("null with a single measurement or too-short gap", () => {
    expect(growthVelocity([{ measured_on: "2026-01-01", height_cm: 140, weight_kg: null }])).toBeNull();
    expect(
      growthVelocity([
        { measured_on: "2026-01-01", height_cm: 140, weight_kg: null },
        { measured_on: "2026-01-20", height_cm: 141, weight_kg: null },
      ]),
    ).toBeNull();
  });
});

describe("maturationCategory", () => {
  it("bands: <=87 pre, 88–95 spurt, >95 post", () => {
    expect(maturationCategory(85)).toBe("pre_spurt");
    expect(maturationCategory(90)).toBe("in_spurt");
    expect(maturationCategory(96)).toBe("post_spurt");
  });
});
