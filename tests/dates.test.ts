import { describe, expect, it } from "vitest";
import { localDate, resolveRange, addDays, dateRange, todayInTz } from "@/lib/dates";

describe("localDate", () => {
  it("respects timezone boundaries", () => {
    // 2026-10-20 23:30 UTC is already Oct 21 in Chisinau (UTC+3)
    const d = new Date("2026-10-20T23:30:00Z");
    expect(localDate(d, "Europe/Chisinau")).toBe("2026-10-21");
    expect(localDate(d, "UTC")).toBe("2026-10-20");
  });
});

describe("resolveRange", () => {
  const tz = "UTC";
  it("7d covers today and 6 days back", () => {
    const { from, to } = resolveRange("7d", tz);
    expect(to).toBe(todayInTz(tz));
    expect(addDays(from, 6)).toBe(to);
  });
  it("prev_month returns a full previous month", () => {
    const { from, to } = resolveRange("prev_month", tz);
    expect(from.slice(0, 7)).toBe(to.slice(0, 7)); // same (previous) month
    expect(from.slice(0, 7)).not.toBe(todayInTz(tz).slice(0, 7));
    expect(from.endsWith("-01")).toBe(true);
    expect(Number(to.slice(8)) >= 28).toBe(true);
  });
  it("custom swaps inverted ranges", () => {
    const { from, to } = resolveRange("custom", tz, { from: "2026-10-20", to: "2026-10-10" });
    expect(from).toBe("2026-10-10");
    expect(to).toBe("2026-10-20");
  });
});

describe("dateRange", () => {
  it("is inclusive", () => {
    expect(dateRange("2026-10-20", "2026-10-22")).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
  });
});
