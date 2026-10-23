import { describe, expect, it } from "vitest";
import { localDate, resolveRange, addDays, dateRange, todayInTz, localDayUtcBounds, localRangeUtcBounds, isValidTimeZone } from "@/lib/dates";

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

describe("localDayUtcBounds", () => {
  it("maps a Chisinau winter day to the correct UTC instants", () => {
    // October in Chisinau is EEST (UTC+3): local midnight = 21:00Z prev day.
    const { start, end } = localDayUtcBounds("2026-10-20", "Europe/Chisinau");
    expect(start.toISOString()).toBe("2026-10-19T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-20T21:00:00.000Z");
    // The [start, end) window covers exactly the local day.
    expect(localDate(start, "Europe/Chisinau")).toBe("2026-10-20");
    expect(localDate(new Date(end.getTime() - 1), "Europe/Chisinau")).toBe("2026-10-20");
    expect(localDate(end, "Europe/Chisinau")).toBe("2026-10-21");
  });

  it("maps a negative-offset day correctly (America/New_York)", () => {
    // EDT (UTC-4): local midnight = 04:00Z same day.
    const { start, end } = localDayUtcBounds("2026-10-20", "America/New_York");
    expect(start.toISOString()).toBe("2026-10-20T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-21T04:00:00.000Z");
  });

  it("handles a 25-hour DST transition day", () => {
    // Europe/Chisinau DST ends 2026-10-25 (clocks go back EEST→EET).
    const { start, end } = localDayUtcBounds("2026-10-25", "Europe/Chisinau");
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    expect(hours).toBe(25);
  });

  it("handles a 23-hour DST transition day", () => {
    // Chisinau DST starts 2026-03-29 (clocks jump forward EET→EEST).
    const { start, end } = localDayUtcBounds("2026-03-29", "Europe/Chisinau");
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    expect(hours).toBe(23);
  });
});

describe("localRangeUtcBounds", () => {
  it("produces an inclusive local range as a [start,end) UTC window", () => {
    const { start, end } = localRangeUtcBounds("2026-10-20", "2026-10-22", "Europe/Chisinau");
    expect(start).toBe("2026-10-19T21:00:00.000Z");
    expect(end).toBe("2026-10-22T21:00:00.000Z"); // local 10-23 00:00 — exclusive
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names, rejects lookalikes", () => {
    expect(isValidTimeZone("Europe/Chisinau")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("Foo/Bar")).toBe(false);
    expect(isValidTimeZone("random")).toBe(false);
  });
});
