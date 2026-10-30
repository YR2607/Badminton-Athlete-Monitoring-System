import { describe, expect, it } from "vitest";
import {
  detectBodyZone,
  mergeGroupPainEntries,
  type GroupPainEntry,
} from "@/components/forms/body-map";
import { getDictionary } from "@/i18n";

describe("detectBodyZone", () => {
  it("maps the RU ankle label to ankle, not shin (голеностоп contains голен)", () => {
    expect(detectBodyZone("Голеностоп / стопа")).toBe("ankle");
    expect(detectBodyZone("голеностоп")).toBe("ankle");
  });

  it("maps every zone chip label back to its own zone in all locales", () => {
    for (const lang of ["ru", "en", "ro"] as const) {
      const zones = getDictionary(lang).pro.bodyZones;
      for (const key of Object.keys(zones) as (keyof typeof zones)[]) {
        expect(detectBodyZone(zones[key]), `${lang}:${key}`).toBe(key);
      }
    }
  });

  it("still detects shin/free-text reports", () => {
    expect(detectBodyZone("Голень / икра")).toBe("shin");
    expect(detectBodyZone("икра")).toBe("shin");
    expect(detectBodyZone("Gambă")).toBe("shin");
    expect(detectBodyZone("колено")).toBe("knee");
    expect(detectBodyZone("Ахилл")).toBe("achilles");
    expect(detectBodyZone(null)).toBeNull();
  });
});

describe("mergeGroupPainEntries", () => {
  const entry = (over: Partial<GroupPainEntry>): GroupPainEntry => ({
    athleteId: "a1",
    athleteName: "Ann",
    date: "2026-10-28",
    location: "Колено",
    side: "right",
    severity: 4,
    dominantHit: false,
    ...over,
  });

  it("collapses repeated reports of the same athlete+zone into one chip", () => {
    const merged = mergeGroupPainEntries([
      entry({ date: "2026-10-24", severity: 3 }),
      entry({ date: "2026-10-26", severity: 7 }),
      entry({ date: "2026-10-28", severity: 4 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].date).toBe("2026-10-28");
    expect(merged[0].severity).toBe(4);
    expect(merged[0].reportCount).toBe(3);
    expect(merged[0].maxSeverity).toBe(7);
  });

  it("keeps separate chips for different zones and different athletes", () => {
    const merged = mergeGroupPainEntries([
      entry({ location: "Колено" }),
      entry({ location: "Плечо" }),
      entry({ athleteId: "a2", athleteName: "Bob", location: "Колено" }),
    ]);
    expect(merged).toHaveLength(3);
  });

  it("counts post-training reports (null severity) without losing peak", () => {
    const merged = mergeGroupPainEntries([
      entry({ date: "2026-10-27", severity: 6 }),
      entry({ date: "2026-10-28", severity: null }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reportCount).toBe(2);
    expect(merged[0].severity).toBeNull();
    expect(merged[0].maxSeverity).toBe(6);
  });

  it("sorts dominant-side hits first, then freshest reports", () => {
    const merged = mergeGroupPainEntries([
      entry({ athleteId: "a1", athleteName: "Zed", date: "2026-10-28", dominantHit: false }),
      entry({ athleteId: "a2", athleteName: "Yan", date: "2026-10-24", dominantHit: true }),
      entry({ athleteId: "a3", athleteName: "Xia", date: "2026-10-26", dominantHit: true }),
    ]);
    expect(merged.map((m) => m.athleteName)).toEqual(["Xia", "Yan", "Zed"]);
  });
});
