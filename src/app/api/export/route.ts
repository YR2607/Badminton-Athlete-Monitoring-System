import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { scopedAthleteIds } from "@/lib/coach-data";
import { localRangeUtcBounds, todayInTz } from "@/lib/dates";
import { buildCsv, buildXlsx, buildHtmlReport, type ExportBundle } from "@/lib/export";
import type { Athlete, Profile } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=athlete|group|all
 *   &athlete_id=..&group_id=..&format=csv|xlsx|html&notes=1
 * Coach: limited to assigned athletes. Admin: everything.
 */
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = req.nextUrl.searchParams;
  const today = todayInTz(profile.timezone);
  const from = DATE_RE.test(url.get("from") ?? "") ? url.get("from")! : today.slice(0, 8) + "01";
  const to = DATE_RE.test(url.get("to") ?? "") ? url.get("to")! : today;
  const format = url.get("format") === "xlsx" ? "xlsx" : url.get("format") === "html" ? "html" : "csv";
  const scope = url.get("scope") ?? "all";
  const includeNotes = url.get("notes") === "1";

  const supabase = await createClient();
  let athleteIds = await scopedAthleteIds(supabase);

  if (scope === "athlete" && url.get("athlete_id")) {
    const target = url.get("athlete_id")!;
    athleteIds = athleteIds.includes(target) ? [target] : [];
  } else if (scope === "group" && url.get("group_id")) {
    const gid = url.get("group_id")!;
    const { data: members } = await supabase
      .from("group_memberships")
      .select("athlete_id")
      .eq("group_id", gid)
      .is("left_at", null);
    const allowed = new Set(athleteIds);
    athleteIds = ((members as { athlete_id: string }[] | null) ?? [])
      .map((m) => m.athlete_id)
      .filter((id) => allowed.has(id));
  }

  if (athleteIds.length === 0) {
    return NextResponse.json({ error: "no_athletes" }, { status: 400 });
  }

  // Timestamp columns are filtered by the exported timezone's local-day
  // bounds ([start, end) — end exclusive). Date columns keep plain date
  // comparisons. The report's declared timezone is what drives the filter.
  const bounds = localRangeUtcBounds(from, to, profile.timezone);
  const { start: tsFrom, end: tsTo } = bounds;

  // Reads use the caller's RLS-scoped client: access control is enforced by
  // policies, not by trusting query params.
  const [{ data: athletes }, { data: memberships }, { data: groups }, { data: morning }, { data: sessions }, { data: post }, { data: snaps }, { data: alerts }, { data: notes }] =
    await Promise.all([
      supabase.from("athletes").select("*").in("id", athleteIds),
      supabase.from("group_memberships").select("athlete_id, group_id").in("athlete_id", athleteIds).is("left_at", null),
      supabase.from("groups").select("*"),
      supabase.from("morning_checkins").select("*").in("athlete_id", athleteIds).gte("checkin_date", from).lte("checkin_date", to).order("checkin_date"),
      supabase.from("training_sessions").select("*").in("athlete_id", athleteIds).gte("started_at", tsFrom).lt("started_at", tsTo).order("started_at"),
      supabase.from("post_training_checkins").select("*").in("athlete_id", athleteIds).gte("submitted_at", tsFrom).lt("submitted_at", tsTo),
      supabase.from("readiness_snapshots").select("*").in("athlete_id", athleteIds).gte("snapshot_date", from).lte("snapshot_date", to),
      supabase.from("alerts").select("*").in("athlete_id", athleteIds).gte("triggered_at", tsFrom).lt("triggered_at", tsTo),
      includeNotes ? supabase.from("coach_notes").select("athlete_id, created_at, kind, note").in("athlete_id", athleteIds).gte("created_at", tsFrom).lt("created_at", tsTo) : Promise.resolve({ data: [] }),
    ]);

  const { data: profs } = ((athletes as Athlete[] | null) ?? []).length
    ? await supabase
        .from("profiles")
        .select("*")
        .in("id", ((athletes as Athlete[]) ?? []).map((a) => a.profile_id))
    : { data: [] };

  const groupById = new Map(((groups as { id: string; name: string }[] | null) ?? []).map((g) => [g.id, g.name]));
  const groupOf = new Map(((memberships as { athlete_id: string; group_id: string }[] | null) ?? []).map((m) => [m.athlete_id, m.group_id]));
  const profById = new Map(((profs as Profile[] | null) ?? []).map((p) => [p.id, p]));

  const bundle: ExportBundle = {
    generatedAt: new Date().toISOString(),
    timezone: profile.timezone,
    rangeFrom: from,
    rangeTo: to,
    athletes: ((athletes as Athlete[]) ?? []).map((a) => ({
      ...a,
      display_name: profById.get(a.profile_id)?.display_name,
      group_name: groupById.get(groupOf.get(a.id) ?? "") ?? "",
    })),
    morning: (morning as ExportBundle["morning"]) ?? [],
    sessions: (sessions as ExportBundle["sessions"]) ?? [],
    postCheckins: (post as ExportBundle["postCheckins"]) ?? [],
    snapshots: (snaps as ExportBundle["snapshots"]) ?? [],
    alerts: (alerts as ExportBundle["alerts"]) ?? [],
    notes: (notes as ExportBundle["notes"]) ?? [],
  };

  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    actor_profile_id: profile.id,
    action: "data.export",
    target_type: "export",
    target_id: null,
    metadata: { from, to, format, scope, athlete_count: athleteIds.length },
  });

  const filename = `rallymonitor-${from}_${to}.${format === "xlsx" ? "xlsx" : format === "html" ? "html" : "csv"}`;
  if (format === "xlsx") {
    const buf = await buildXlsx(bundle);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  if (format === "html") {
    return new NextResponse(buildHtmlReport(bundle, "RallyMonitor report"), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="${filename}"` },
    });
  }
  return new NextResponse(buildCsv(bundle), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
