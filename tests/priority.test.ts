import { describe, expect, it } from "vitest";
import { belowNormFlag, classifyAthlete, type PriorityInput } from "@/lib/priority";

const base: PriorityInput = {
  status: "ok",
  acuteSignal: false,
  hasDeclineAlert: false,
  belowNorm: false,
  hasTodayCheckin: true,
  pendingPostCount: 0,
  lastCheckinAgeDays: 0,
  normDays: 12,
  scheduledMissedYesterday: false,
  hasPain: false,
};

describe("classifyAthlete — mutually exclusive categories", () => {
  it("acute symptom + missing check-in → check (red flags win over missing)", () => {
    const r = classifyAthlete({ ...base, status: "needs_check", acuteSignal: true, hasTodayCheckin: false });
    expect(r).toEqual({ category: "check", reason: "acute_flags" });
  });

  it("decline trend + missing check-in → review (verified trend outranks missing)", () => {
    const r = classifyAthlete({ ...base, status: "declining", hasDeclineAlert: true, hasTodayCheckin: false });
    expect(r).toEqual({ category: "review", reason: "decline_alert" });
  });

  it("no check-in and no other signals → missing, never a bad state", () => {
    const r = classifyAthlete({ ...base, hasTodayCheckin: false, lastCheckinAgeDays: 1 });
    expect(r).toEqual({ category: "missing", reason: "no_checkin_today" });
  });

  it("check-in exists but norm not formed → missing/norm_not_formed", () => {
    const r = classifyAthlete({ ...base, status: "insufficient", normDays: 3 });
    expect(r).toEqual({ category: "missing", reason: "norm_not_formed" });
    // normDays === 0 also means no norm even if status isn't insufficient
    expect(classifyAthlete({ ...base, normDays: 0 }).reason).toBe("norm_not_formed");
  });

  it("one below-norm day → review flagged as single-day deviation", () => {
    const r = classifyAthlete({ ...base, belowNorm: true });
    expect(r).toEqual({ category: "review", reason: "below_norm" });
  });

  it("several days of decline (alert-verified) → review/decline_alert", () => {
    const r = classifyAthlete({ ...base, status: "declining", hasDeclineAlert: true });
    expect(r).toEqual({ category: "review", reason: "decline_alert" });
  });

  it("no signals and sufficient data → none (not a clearance)", () => {
    const r = classifyAthlete(base);
    expect(r).toEqual({ category: "none", reason: "no_signals" });
  });

  it("pending post-training questionnaire → missing/pending_post", () => {
    const r = classifyAthlete({ ...base, pendingPostCount: 2 });
    expect(r).toEqual({ category: "missing", reason: "pending_post" });
  });

  it("scheduled session missed yesterday → missing/missed_session", () => {
    const r = classifyAthlete({ ...base, scheduledMissedYesterday: true });
    expect(r).toEqual({ category: "missing", reason: "missed_session" });
  });

  it("long-stale check-in data → missing/stale_checkin", () => {
    const r = classifyAthlete({ ...base, hasTodayCheckin: false, lastCheckinAgeDays: 5 });
    expect(r).toEqual({ category: "missing", reason: "stale_checkin" });
  });

  it("missing check-in with a below-norm score still → review (data signal wins)", () => {
    const r = classifyAthlete({ ...base, belowNorm: true, hasTodayCheckin: false });
    expect(r.category).toBe("review");
  });

  it("non-acute reported pain → review/pain_reported (not check)", () => {
    const r = classifyAthlete({ ...base, hasPain: true });
    expect(r).toEqual({ category: "review", reason: "pain_reported" });
  });

  it("acute signal outranks pain and missing data", () => {
    const r = classifyAthlete({ ...base, status: "needs_check", acuteSignal: true, hasPain: true, hasTodayCheckin: false });
    expect(r.category).toBe("check");
  });
});

describe("belowNormFlag", () => {
  const norm = { avg: 70, sd: 5, count: 12, version: 2 };

  it("flags a score more than 1 sd below the norm", () => {
    expect(belowNormFlag(60, norm)).toBe(true);
    expect(belowNormFlag(66, norm)).toBe(false);
  });

  it("flags a >=15-point absolute drop even with sd 0", () => {
    const flat = { avg: 70, sd: 0, count: 12, version: 2 };
    expect(belowNormFlag(55, flat)).toBe(true);
    expect(belowNormFlag(56, flat)).toBe(false);
  });

  it("returns false without norm or score — never guesses", () => {
    expect(belowNormFlag(null, norm)).toBe(false);
    expect(belowNormFlag(40, null)).toBe(false);
  });
});
