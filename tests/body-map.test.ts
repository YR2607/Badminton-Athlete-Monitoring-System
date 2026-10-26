import { describe, expect, it } from "vitest";
import { detectBodyZone } from "@/components/forms/body-map";
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
