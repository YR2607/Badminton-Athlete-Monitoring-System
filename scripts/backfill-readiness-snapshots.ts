/**
 * Backfill readiness_snapshots to the morning-only formula.
 *
 * Old rows stored the removed 70/30 morning+evening blend. Recomputes every
 * athlete's snapshots from morning_checkins via recomputeSnapshots()
 * (src/lib/backfill.ts) and upserts — idempotent on
 * (athlete_id, snapshot_date). Never re-runs alerts or recommendations.
 *
 * Usage (dry-run by default):
 *   npx tsx --env-file=.env.local scripts/backfill-readiness-snapshots.ts
 *   npx tsx --env-file=.env.local scripts/backfill-readiness-snapshots.ts --write
 */
import { createClient } from "@supabase/supabase-js";
import { recomputeSnapshots } from "../src/lib/backfill";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
  process.exit(1);
}
async function main() {
  const write = process.argv.includes("--write");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: athletes, error } = await sb.from("athletes").select("id");
  if (error) throw error;

  let rows = 0;
  for (const a of athletes ?? []) {
    const { data: checkins } = await sb
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", a.id)
      .order("checkin_date", { ascending: true });
    const snaps = recomputeSnapshots(checkins ?? []);
    if (!write) {
      rows += snaps.length;
      console.log(`${a.id}: ${snaps.length} snapshots would be recomputed`);
      continue;
    }
    if (snaps.length === 0) continue;
    const { error: upErr } = await sb.from("readiness_snapshots").upsert(
      snaps.map((s) => ({
        athlete_id: a.id,
        snapshot_date: s.snapshot_date,
        calculated_at: new Date().toISOString(),
        ...s.body,
      })),
      { onConflict: "athlete_id,snapshot_date" },
    );
    if (upErr) throw upErr;
    rows += snaps.length;
    console.log(`${a.id}: ${snaps.length} snapshots upserted`);
  }
  console.log(write ? `Done — ${rows} snapshots upserted.` : `Dry run — ${rows} snapshots would change.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
