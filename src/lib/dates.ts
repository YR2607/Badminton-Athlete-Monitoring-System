// Timezone-safe calendar-date helpers. We never assume the server TZ.

/** "YYYY-MM-DD" of `date` as seen in `tz` (IANA name, e.g. "Europe/Chisinau"). */
export function localDate(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function localHour(date: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(date),
  );
}

/** Weekday 0-6 (Sunday-first, matches DB schedule rows) in the given TZ. */
export function localWeekday(date: Date, tz: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayInTz(tz: string): string {
  return localDate(new Date(), tz);
}

/** Inclusive list of calendar dates between from and to (YYYY-MM-DD). */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type RangeKey = "7d" | "14d" | "30d" | "90d" | "month" | "prev_month" | "custom";

export function resolveRange(
  key: RangeKey,
  tz: string,
  custom?: { from?: string; to?: string },
): { from: string; to: string } {
  const today = todayInTz(tz);
  switch (key) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "14d":
      return { from: addDays(today, -13), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "month": {
      const first = `${today.slice(0, 7)}-01`;
      return { from: first, to: today };
    }
    case "prev_month": {
      const thisFirst = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      const prevLast = addDays(thisFirst.toISOString().slice(0, 10), -1);
      return { from: `${prevLast.slice(0, 7)}-01`, to: prevLast };
    }
    case "custom": {
      const from = custom?.from && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? custom.from : addDays(today, -29);
      const to = custom?.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? custom.to : today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}
