import { describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n";
import { buildSurveyRows } from "@/components/today-checklist";
import type { TodaySurveyStatus } from "@/lib/types";

const d = getDictionary("ru").athleteHome;

const base: TodaySurveyStatus = {
  morningDone: false,
  postDone: false,
  scheduledToday: true,
  ostrcEnabled: false,
  ostrcDone: false,
  academyOn: false,
  academyTotal: 0,
  academyDone: 0,
};

describe("buildSurveyRows", () => {
  it("always lists the two daily health questionnaires", () => {
    const rows = buildSurveyRows(d, base);
    expect(rows.map((r) => r.key)).toEqual(["morning", "post"]);
    expect(rows.every((r) => !r.done)).toBe(true);
  });

  it("adds the weekly OSTRC survey only when enabled, and marks it done", () => {
    const pending = buildSurveyRows(d, { ...base, ostrcEnabled: true });
    expect(pending.map((r) => r.key)).toContain("ostrc");
    expect(pending.find((r) => r.key === "ostrc")!.done).toBe(false);

    const filled = buildSurveyRows(d, {
      ...base,
      ostrcEnabled: true,
      ostrcDone: true,
    });
    expect(filled.find((r) => r.key === "ostrc")!.done).toBe(true);
  });

  it("shows the academy daily lesson with partial progress", () => {
    const rows = buildSurveyRows(d, {
      ...base,
      academyOn: true,
      academyTotal: 3,
      academyDone: 1,
    });
    const academy = rows.find((r) => r.key === "academy")!;
    expect(academy.done).toBe(false);
    expect(academy.hint).toContain("1");
    expect(academy.hint).toContain("3");

    const done = buildSurveyRows(d, {
      ...base,
      academyOn: true,
      academyTotal: 3,
      academyDone: 3,
    });
    expect(done.find((r) => r.key === "academy")!.done).toBe(true);
  });

  it("keeps done rows visible so kids see every questionnaire", () => {
    const rows = buildSurveyRows(d, { ...base, morningDone: true });
    const morning = rows.find((r) => r.key === "morning")!;
    expect(morning.done).toBe(true);
    expect(morning.hintTone).toBe("ok");
  });

  it("softens the post-training row when no session was scheduled", () => {
    const rows = buildSurveyRows(d, { ...base, scheduledToday: false });
    const post = rows.find((r) => r.key === "post")!;
    expect(post.soft).toBe(true);
    expect(post.hint).toBe(d.noTrainingScheduled);
  });

  it("drops the excluded row (the page the athlete is already on)", () => {
    expect(buildSurveyRows(d, base, "morning").map((r) => r.key)).toEqual(["post"]);
    const withExtras = buildSurveyRows(
      d,
      { ...base, ostrcEnabled: true, academyOn: true, academyTotal: 3 },
      "ostrc",
    );
    expect(withExtras.map((r) => r.key)).toEqual(["morning", "post", "academy"]);
  });
});
