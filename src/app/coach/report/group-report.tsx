import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/dates";
import { athleteStats } from "@/lib/analytics";
import { postsByLocalDate } from "@/lib/readiness";
import { PrintButton } from "./print-button";
import type { Dictionary } from "@/i18n";
import type {
  Alert, Athlete, Group, MorningCheckin,
  PainReport, PostTrainingCheckin, Profile, TrainingSession,
} from "@/lib/types";

/** Whole-group period report — one compact row per athlete, printable. */
export async function GroupReport({
  groupId,
  days,
  from,
  to,
  athletes,
  tz,
  dict,
}: {
  groupId: string;
  days: string[];
  from: string;
  to: string;
  athletes: Athlete[];
  tz: string;
  dict: Dictionary;
}) {
  const d = dict.report;
  const supabase = await createClient();

  const [{ data: group }, { data: members }, { data: profs }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", groupId).maybeSingle(),
    supabase.from("group_memberships").select("athlete_id").eq("group_id", groupId).is("left_at", null),
    supabase.from("profiles").select("id, display_name, timezone"),
  ]);
  const ids = ((members as { athlete_id: string }[]) ?? []).map((m) => m.athlete_id);
  const profById = new Map((profs as Profile[] | null ?? []).map((p) => [p.id, p]));
  const rows = athletes.filter((a) => ids.includes(a.id) && a.status === "active");
  if (!group || rows.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p className="text-sm text-muted">{d.noAthlete}</p>
      </main>
    );
  }

  const [ckRes, postRes, sesRes, alertRes, attRes, painRes] = await Promise.all([
    supabase.from("morning_checkins").select("*").in("athlete_id", ids)
      .gte("checkin_date", from).lte("checkin_date", to),
    supabase.from("post_training_checkins").select("*").in("athlete_id", ids)
      .gte("submitted_at", `${from}T00:00:00Z`).lte("submitted_at", `${to}T23:59:59Z`),
    supabase.from("training_sessions").select("*").in("athlete_id", ids)
      .gte("started_at", `${from}T00:00:00Z`).lt("started_at", `${to}T23:59:59Z`),
    supabase.from("alerts").select("*").in("athlete_id", ids)
      .gte("triggered_at", `${from}T00:00:00Z`).lte("triggered_at", `${to}T23:59:59Z`),
    supabase.from("attendance").select("*").in("athlete_id", ids)
      .gte("date", from).lte("date", to),
    supabase.from("pain_reports").select("*").in("athlete_id", ids)
      .gte("report_date", from).lte("report_date", to),
  ]);
  const checkins = (ckRes.data as MorningCheckin[]) ?? [];
  const posts = (postRes.data as PostTrainingCheckin[]) ?? [];
  const sessions = (sesRes.data as TrainingSession[]) ?? [];
  const alerts = (alertRes.data as Alert[]) ?? [];
  const attendance = (attRes.data as { athlete_id: string; status: string }[]) ?? [];
  const pains = (painRes.data as PainReport[]) ?? [];

  const rowsOut = rows.map((a) => {
    const aTz = profById.get(a.profile_id)?.timezone ?? tz;
    const st = athleteStats(
      a.id, days,
      checkins.filter((c) => c.athlete_id === a.id),
      sessions.filter((s) => s.athlete_id === a.id),
      alerts.filter((x) => x.athlete_id === a.id),
      postsByLocalDate(posts.filter((p) => p.athlete_id === a.id), aTz),
      aTz,
    );
    const au = sessions
      .filter((s) => s.athlete_id === a.id && s.session_rpe != null && s.duration_minutes != null)
      .reduce((x, s) => x + s.session_rpe! * s.duration_minutes!, 0);
    const att = attendance.filter((x) => x.athlete_id === a.id);
    return {
      a,
      name: profById.get(a.profile_id)?.display_name ?? a.athlete_code,
      st,
      au,
      pain: pains.filter((p) => p.athlete_id === a.id).length,
      maxSev: Math.max(0, ...pains.filter((p) => p.athlete_id === a.id).map((p) => p.severity ?? 0)),
      present: att.filter((x) => x.status === "present").length,
      absent: att.filter((x) => x.status === "absent").length,
      openAlerts: alerts.filter((x) => x.athlete_id === a.id && x.status === "open").length,
    };
  });

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <a href="/coach" className="text-sm text-accent">← {dict.nav.home}</a>
        <PrintButton label={d.print} />
      </div>
      <header>
        <h1 className="text-2xl font-bold">{d.groupTitle}: {(group as Group).name}</h1>
        <p className="text-sm text-muted">{from} → {to}</p>
      </header>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="p-2.5">{d.colAthlete}</th>
              <th className="p-2.5">{d.colFill}</th>
              <th className="p-2.5">{d.colScore}</th>
              <th className="p-2.5">{d.colAU}</th>
              <th className="p-2.5">{d.colPain}</th>
              <th className="p-2.5">{d.colAtt}</th>
              <th className="p-2.5">{d.colAlerts}</th>
            </tr>
          </thead>
          <tbody>
            {rowsOut.map((r) => (
              <tr key={r.a.id} className="border-b border-border/50 last:border-0">
                <td className="p-2.5 font-medium">
                  <a href={`/coach/report?athlete=${r.a.id}&period=${days.length > 10 ? "month" : "7d"}`}
                     className="text-accent hover:underline print:text-foreground print:no-underline">
                    {r.name}
                  </a>
                </td>
                <td className="p-2.5 tabular-nums">{r.st.filled}/{r.st.expected} ({r.st.rate}%)</td>
                <td className="p-2.5 tabular-nums">{r.st.avgReadiness ?? "—"}</td>
                <td className="p-2.5 tabular-nums">{r.au || "—"}</td>
                <td className="p-2.5 tabular-nums">
                  {r.pain === 0 ? "—" : `${r.pain}${r.maxSev >= 7 ? " ⚠️" : ""}`}
                </td>
                <td className="p-2.5 tabular-nums">{r.present}/{r.present + r.absent || "—"}</td>
                <td className="p-2.5 tabular-nums">{r.openAlerts || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted">
        {d.groupLegend.replace("{n}", String(rowsOut.length))} · {localDate(new Date(), tz)}
      </p>
    </main>
  );
}
