/**
 * Backfill training_sessions.duration_minutes from the coach's plan.
 *
 * Historically the athlete form silently submitted planned_minutes, so every
 * stored duration was a verbatim copy of the plan at that time. Now that the
 * coach's schedule is the single source of truth, this rewrites each
 * non-match session's duration to the plan resolved for that session's date
 * (per-date override wins over the weekday template). session_load is a
 * generated column and recomputes itself.
 *
 * Caveats:
 * - The weekly template is the CURRENT one — if it changed since a session
 *   was recorded, old dates get today's template values. Per-date overrides
 *   (session_plan_overrides) are exact.
 * - Match sessions (match_discipline NOT NULL) are never touched — match
 *   minutes are athlete-reported real values.
 * - Sessions whose group has no planned_minutes for that date keep their
 *   current duration.
 *
 * Usage (dry-run by default):
 *   npx tsx --env-file=.env.local scripts/backfill-session-minutes.ts
 *   npx tsx --env-file=.env.local scripts/backfill-session-minutes.ts --write
 */
import { createClient } from "@supabase/supabase-js";
import { plannedForDate, type PlanOverride, type ScheduleInput } from "../src/lib/load";
import { localDate } from "../src/lib/dates";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
  process.exit(1);
}

const PAGE = 1000;

async function fetchAll<T>(
  run: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function main() {
  const write = process.argv.includes("--write");
  const sb = createClient(url as string, key as string, { auth: { persistSession: false } });

  const athletes = await fetchAll<{ id: string; profiles: { timezone: string } | { timezone: string }[] | null }>(
    (from) =>
      sb.from("athletes").select("id, profiles(timezone)").range(from, from + PAGE - 1),
    "athletes",
  );
  const tzByAthlete = new Map(
    athletes.map((a) => {
      const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
      return [a.id, p?.timezone ?? "Europe/Chisinau"];
    }),
  );

  const schedules = await fetchAll<ScheduleInput & { group_id: string }>(
    (from) =>
      sb
        .from("training_schedules")
        .select("group_id, weekday, planned_minutes, planned_rpe")
        .eq("active", true)
        .range(from, from + PAGE - 1),
    "training_schedules",
  );
  const overrides = await fetchAll<PlanOverride & { group_id: string }>(
    (from) =>
      sb
        .from("session_plan_overrides")
        .select("group_id, plan_date, cancelled, start_time, planned_minutes, planned_rpe")
        .range(from, from + PAGE - 1),
    "session_plan_overrides",
  );

  const schedByGroup = new Map<string, ScheduleInput[]>();
  for (const s of schedules) {
    const list = schedByGroup.get(s.group_id) ?? [];
    list.push(s);
    schedByGroup.set(s.group_id, list);
  }
  const ovByGroup = new Map<string, PlanOverride[]>();
  for (const o of overrides) {
    const list = ovByGroup.get(o.group_id) ?? [];
    list.push(o);
    ovByGroup.set(o.group_id, list);
  }

  const sessions = await fetchAll<{
    id: string;
    athlete_id: string;
    group_id: string;
    started_at: string;
    duration_minutes: number | null;
    session_rpe: number | null;
  }>(
    (from) =>
      sb
        .from("training_sessions")
        .select("id, athlete_id, group_id, started_at, duration_minutes, session_rpe")
        .is("match_discipline", null)
        .not("group_id", "is", null)
        .range(from, from + PAGE - 1),
    "training_sessions",
  );
  console.log(`Sessions to inspect: ${sessions.length}`);

  const updates: { id: string; from: number | null; to: number; date: string; load: number | null }[] = [];
  let skippedNoPlan = 0;
  let skippedSame = 0;

  for (const s of sessions) {
    const tz = tzByAthlete.get(s.athlete_id) ?? "Europe/Chisinau";
    const date = localDate(new Date(s.started_at), tz);
    const plan = plannedForDate(
      date,
      schedByGroup.get(s.group_id) ?? [],
      ovByGroup.get(s.group_id) ?? [],
    );
    if (plan.planned_minutes == null) {
      skippedNoPlan++;
      continue;
    }
    if (s.duration_minutes === plan.planned_minutes) {
      skippedSame++;
      continue;
    }
    updates.push({
      id: s.id,
      from: s.duration_minutes,
      to: plan.planned_minutes,
      date,
      load: s.session_rpe != null ? s.session_rpe * plan.planned_minutes : null,
    });
  }

  for (const u of updates) {
    console.log(
      `${u.id} [${u.date}]: ${u.from ?? "NULL"} -> ${u.to} min` +
        (u.load != null ? ` (load ${u.load} AU)` : " (no RPE)"),
    );
  }
  console.log(
    `${updates.length} to update, ${skippedSame} already match plan, ${skippedNoPlan} skipped (no planned minutes).`,
  );

  if (!write) {
    console.log("Dry run — re-run with --write to apply.");
    return;
  }
  let done = 0;
  for (const u of updates) {
    const { error } = await sb
      .from("training_sessions")
      .update({ duration_minutes: u.to })
      .eq("id", u.id);
    if (error) throw new Error(`${u.id}: ${error.message}`);
    done++;
  }
  console.log(`Done — ${done} sessions updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
