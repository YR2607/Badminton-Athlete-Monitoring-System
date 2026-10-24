import { describe, expect, it } from "vitest";
import {
  isoWeekMonday,
  ostrcAnyProblem,
  ostrcSeverity,
  ostrcSubstantial,
  validateOstrc,
} from "@/lib/ostrc";

// Control cases from the OSTRC-O2 spec (Clarsen 2020 gatekeeper + scoring).
describe("ostrc scoring", () => {
  const cases: [
    q1: 0 | 8 | 17 | 25,
    q2: number | null,
    q3: number | null,
    q4: number | null,
    severity: number,
    substantial: boolean,
  ][] = [
    [0, null, null, null, 0, false],       // A
    [25, null, null, null, 100, true],     // D
    [8, 0, 0, 8, 16, false],               // B A A B
    [8, 8, 8, 17, 41, false],              // B B B C
    [8, 17, 0, 8, 33, true],               // B C A B
    [17, 8, 25, 17, 67, true],             // C B D C
    [17, 25, 25, 25, 92, true],            // C D D D
  ];
  for (const [q1, q2, q3, q4, severity, substantial] of cases) {
    it(`q1=${q1} q2-4=${[q2, q3, q4]} -> ${severity}/sub=${substantial}`, () => {
      const input = { q1: q1 as never, q2: q2 as never, q3: q3 as never, q4: q4 as never };
      const v = validateOstrc(input);
      expect("error" in v).toBe(false);
      expect(ostrcSeverity(input)).toBe(severity);
      expect(ostrcSubstantial(input)).toBe(substantial);
      expect(ostrcAnyProblem(input)).toBe(q1 !== 0);
    });
  }
});

describe("ostrc validation", () => {
  it("rejects Q2–Q4 when Q1 is A or D (gatekeeper)", () => {
    expect(validateOstrc({ q1: 0, q2: 8, q3: 0, q4: 0 })).toEqual({ error: "gatekeeper_violation" });
    expect(validateOstrc({ q1: 25, q2: 0, q3: 0, q4: 0 })).toEqual({ error: "gatekeeper_violation" });
  });
  it("requires Q2–Q4 when Q1 is B or C", () => {
    expect(validateOstrc({ q1: 8, q2: 8, q3: null, q4: 8 })).toEqual({ error: "answers_required" });
  });
  it("rejects invalid answer values", () => {
    expect(validateOstrc({ q1: 8, q2: 5 as never, q3: 0, q4: 0 })).toEqual({ error: "answer_invalid" });
  });
});

describe("isoWeekMonday", () => {
  it("maps days to the week's Monday", () => {
    expect(isoWeekMonday("2026-01-21")).toBe("2026-01-19"); // Wed -> Mon
    expect(isoWeekMonday("2026-01-19")).toBe("2026-01-19"); // Mon -> Mon
    expect(isoWeekMonday("2026-01-25")).toBe("2026-01-19"); // Sun -> Mon
  });
});
