import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, avatarPublicUrl, getAvatarPreset, isValidAvatarId } from "@/lib/avatars";

describe("AVATAR_PRESETS", () => {
  it("contains 40 world badminton stars with real portrait URLs plus 12 totems", () => {
    const legends = AVATAR_PRESETS.filter((p) => p.category === "legend");
    const totems = AVATAR_PRESETS.filter((p) => p.category === "totem");
    expect(legends.length).toBe(40);
    expect(totems.length).toBe(12);
    for (const l of legends) {
      expect(l.photoUrl).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    }
  });

  it("has unique IDs across all presets and validates them", () => {
    const ids = AVATAR_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isValidAvatarId("axelsen")).toBe(true);
    expect(isValidAvatarId("gold-shuttle")).toBe(true);
    expect(isValidAvatarId("unknown-id")).toBe(false);
    expect(getAvatarPreset("lin-dan")?.title.en).toBe("Lin Dan");
    expect(avatarPublicUrl("gold-shuttle")).toMatch(/^data:image\/svg\+xml/);
  });
});
