import { describe, expect, it } from "vitest";
import { recomputeSnapshots } from "@/lib/backfill";
import { morningWellnessScore } from "@/lib/readiness";
import type { MorningCheckin } from "@/lib/types";

const mk = (date: string, over: Partial<MorningCheckin> = {}): MorningCheckin => ({
  id: `c-${date}`,
  athlete_id: "a1",
  checkin_date: date,
  submitted_at: `${date}T07:00:00Z`,
  sleep_score: 8,
  sleep_hours: null,
  recovery_score: 8,
  fatigue_score: 3,
  muscle_soreness_score: 2,
  stress_score: 3,
  mood_score: 8,
  pain_status: "none",
  pain_location: null,
  pain_side: null,
  pain_severity: null,
  pain_onset: null,
  pain_triggers: [],
  swelling: null,
  movement_limitation: null,
  symptoms: null,
  notes: null,
  ...over,
});

describe("recomputeSnapshots", () => {
  it("stores the morning-only score — no evening data can leak in", () => {
    const c = mk("2026-10-20", {
      sleep_score: 10, recovery_score: 10, fatigue_score: 1,
      muscle_soreness_score: 1, stress_score: 1, mood_score: 10,
    });
    const [snap] = recomputeSnapshots([c]);
    expect(snap.snapshot_date).toBe("2026-10-20");
    expect(snap.body.readiness_score).toBe(100);
    expect(snap.body.readiness_score).toBe(morningWellnessScore(c));
  });

  it("computes the norm per date from prior days only (day excluded)", () => {
    const checkins = Array.from({ length: 10 }, (_, i) =>
      mk(`2026-10-${String(10 + i).padStart(2, "0")}`, {
        sleep_score: 8, recovery_score: 8, fatigue_score: 2,
        muscle_soreness_score: 2, stress_score: 2, mood_score: 8,
      }),
    );
    const snaps = recomputeSnapshots(checkins);
    // First day can have no norm (nothing before it).
    expect(snaps[0].body.baseline_avg).toBeNull();
    // Day 9 norm uses days 1..8 — not itself.
    const last = snaps[9].body;
    expect(last.baseline_avg).not.toBeNull();
    expect(last.explanation.delta_vs_baseline).toBeCloseTo(
      last.readiness_score - (last.baseline_avg as number),
      1,
    );
  });

  it("is deterministic — same input, same snapshots (idempotent)", () => {
    const checkins = [mk("2026-10-20"), mk("2026-10-21"), mk("2026-10-22")];
    expect(recomputeSnapshots(checkins)).toEqual(recomputeSnapshots(checkins));
  });
});
