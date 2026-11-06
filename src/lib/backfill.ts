import { buildSnapshot, morningWellnessScore, personalNorm, type SnapshotBuild } from "@/lib/readiness";
import type { MorningCheckin } from "@/lib/types";

/**
 * Historical readiness_snapshot backfill.
 *
 * Old snapshots stored the removed 70/30 morning+evening blend; rows are
 * recomputed from morning_checkins only, so the whole history uses ONE
 * formula. For every date the personal norm is built from scores strictly
 * BEFORE that date — never including the day itself.
 *
 * Pure computation — the script (scripts/backfill-readiness-snapshots.mjs)
 * fetches rows and upserts these bodies; idempotent by
 * (athlete_id, snapshot_date).
 */
export function recomputeSnapshots(
  checkins: MorningCheckin[],
): { snapshot_date: string; body: SnapshotBuild }[] {
  const sorted = checkins
    .slice()
    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
  // Morning-only series used as the norm window for each date.
  const series = sorted.map((c) => ({
    date: c.checkin_date,
    score: morningWellnessScore(c),
  }));
  return sorted.map((c, i) => ({
    snapshot_date: c.checkin_date,
    body: buildSnapshot(c, personalNorm(series.slice(0, i + 1), c.checkin_date)),
  }));
}
