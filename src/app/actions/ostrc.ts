"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentAthlete, getCurrentProfile, audit } from "@/lib/auth";
import { ostrcSubmitSchema } from "@/lib/validation";
import {
  ostrcAnyProblem,
  ostrcSeverity,
  ostrcSubstantial,
  validateOstrc,
  type OstrcAnswer,
} from "@/lib/ostrc";
import { localDate } from "@/lib/dates";
import type { OstrcResponse } from "@/lib/types";

export type ActionResult = { ok?: boolean; error?: string };

const RECO: Record<string, Record<string, string>> = {
  ostrc_substantial: {
    ru: "Существенная проблема OSTRC — осмотр, ограничить нагрузку на зону.",
    en: "Substantial OSTRC problem — examine the athlete, limit load on the area.",
    ro: "Problemă semnificativă OSTRC — examinați sportivul, limitați încărcarea zonei.",
  },
  ostrc_growing: {
    ru: "Тяжесть проблемы растёт 2 недели подряд — наблюдение, снизить нагрузку.",
    en: "Problem severity rising 2 weeks in a row — monitor, reduce load.",
    ro: "Severitatea problemei crește 2 săptămâni la rând — monitorizați, reduceți încărcarea.",
  },
  ostrc_chronic: {
    ru: "Проблема в одной зоне ≥3 недель подряд — рекомендуется осмотр физиотерапевта.",
    en: "Problem in the same zone for 3+ weeks — physiotherapist review recommended.",
    ro: "Problemă în aceeași zonă de 3+ săptămâni — recomandată evaluare de kinetoterapeut.",
  },
};

/**
 * Athlete submits the weekly OSTRC-O2 survey. Scoring is computed on the
 * server (never trusted from the client); alerts are evaluated here since
 * they only depend on OSTRC history, not on the daily readiness pipeline.
 */
export async function submitOstrc(input: unknown): Promise<ActionResult> {
  const parsed = ostrcSubmitSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const athlete = await getCurrentAthlete();
  const profile = await getCurrentProfile();
  if (!athlete || !profile) return { error: "forbidden" };

  const supabase = await createClient();

  // Phase 10: OSTRC is sensitive health data — needs granted parental consent.
  const { data: consent } = await supabase
    .from("consent_records")
    .select("status")
    .eq("athlete_id", athlete.id)
    .eq("consent_type", "parental_data_processing")
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (consent?.status !== "granted") return { error: "consent_required" };

  const { data: zones } = await supabase.from("ostrc_zones").select("code").eq("active", true);
  const validZones = new Set(((zones as { code: string }[] | null) ?? []).map((z) => z.code));

  const rows: Record<string, unknown>[] = [];
  for (const z of parsed.data.zones) {
    if (!validZones.has(z.zone_code)) return { error: "validation" };
    const v = validateOstrc({
      q1: z.q1 as OstrcAnswer,
      q2: z.q2 as OstrcAnswer | null,
      q3: z.q3 as OstrcAnswer | null,
      q4: z.q4 as OstrcAnswer | null,
    });
    if ("error" in v) return { error: v.error };
    rows.push({
      athlete_id: athlete.id,
      week_start_date: parsed.data.week_start_date,
      zone_code: z.zone_code,
      q1: v.q1,
      q2: v.q2,
      q3: v.q3,
      q4: v.q4,
      severity: ostrcSeverity(v),
      substantial: ostrcSubstantial(v),
      any_problem: ostrcAnyProblem(v),
      onset_date: z.onset_date ?? null,
      days_missed: z.days_missed ?? null,
      informed: z.informed ?? [],
      other_reason: z.other_reason ?? false,
      comment: z.comment ?? null,
      locale: parsed.data.locale ?? profile.preferred_language,
    });
  }

  const { error } = await supabase
    .from("ostrc_responses")
    .upsert(rows, { onConflict: "athlete_id,week_start_date,zone_code" });
  if (error) return { error: error.message };

  // ---- alerts (only depend on OSTRC history — evaluated on submit) ----
  const admin = createAdminClient();
  const [{ data: rules }, { data: history }] = await Promise.all([
    admin.from("alert_rules").select("code, severity, params").eq("enabled", true).in("code", [
      "ostrc_substantial",
      "ostrc_growing",
      "ostrc_chronic",
    ]),
    admin
      .from("ostrc_responses")
      .select("week_start_date, zone_code, severity, substantial, any_problem")
      .eq("athlete_id", athlete.id)
      .order("week_start_date", { ascending: false })
      .limit(60),
  ]);
  const enabled = new Map(
    (((rules ?? []) as { code: string; severity: string; params: Record<string, unknown> }[]))
      .filter((r) => r.code)
      .map((r) => [r.code, r]),
  );
  const hist = (history as Pick<OstrcResponse, "week_start_date" | "zone_code" | "severity" | "substantial" | "any_problem">[] | null) ?? [];
  const byZone = new Map<string, typeof hist>();
  for (const h of hist) {
    const list = byZone.get(h.zone_code) ?? [];
    list.push(h);
    byZone.set(h.zone_code, list);
  }
  const lang = profile.preferred_language;
  const week = parsed.data.week_start_date;
  const reco = (code: string) => RECO[code]?.[lang] ?? RECO[code]?.en ?? "";

  for (const z of parsed.data.zones) {
    const series = (byZone.get(z.zone_code) ?? []).sort((a, b) =>
      b.week_start_date.localeCompare(a.week_start_date),
    );
    const thisWeek = series.find((s) => s.week_start_date === week);
    const lastWeek = series.find((s) => s.week_start_date < week);

    if (thisWeek?.substantial && enabled.has("ostrc_substantial")) {
      const r = enabled.get("ostrc_substantial")!;
      await admin.rpc("record_alert", {
        p_athlete_id: athlete.id,
        p_rule_code: "ostrc_substantial",
        p_severity: r.severity,
        p_evidence: { zone: z.zone_code, week, severity: thisWeek.severity },
        p_recommendation: reco("ostrc_substantial"),
        p_dedup_key: `${athlete.id}:ostrc_substantial:${z.zone_code}:${week}`,
      });
    }
    if (
      thisWeek && lastWeek &&
      thisWeek.severity > lastWeek.severity && lastWeek.severity > 0 &&
      enabled.has("ostrc_growing")
    ) {
      const r = enabled.get("ostrc_growing")!;
      await admin.rpc("record_alert", {
        p_athlete_id: athlete.id,
        p_rule_code: "ostrc_growing",
        p_severity: r.severity,
        p_evidence: { zone: z.zone_code, week, severity: thisWeek.severity, prev: lastWeek.severity },
        p_recommendation: reco("ostrc_growing"),
        p_dedup_key: `${athlete.id}:ostrc_growing:${z.zone_code}:${week}`,
      });
    }
    if (thisWeek?.any_problem && enabled.has("ostrc_chronic")) {
      const need = Number(enabled.get("ostrc_chronic")!.params?.weeks ?? 3);
      // Count consecutive weekly entries ending this week with any_problem.
      let streak = 0;
      const weekMs = 7 * 24 * 3600 * 1000;
      let cursor = new Date(`${week}T00:00:00Z`).getTime();
      const byDate = new Map(series.map((s) => [s.week_start_date, s.any_problem]));
      while (true) {
        const d = localDate(new Date(cursor), "UTC");
        const flag = byDate.get(d);
        if (flag === undefined || !flag) break;
        streak++;
        cursor -= weekMs;
      }
      if (streak >= need) {
        const r = enabled.get("ostrc_chronic")!;
        await admin.rpc("record_alert", {
          p_athlete_id: athlete.id,
          p_rule_code: "ostrc_chronic",
          p_severity: r.severity,
          p_evidence: { zone: z.zone_code, week, weeks: streak },
          p_recommendation: reco("ostrc_chronic"),
          p_dedup_key: `${athlete.id}:ostrc_chronic:${z.zone_code}:${week}`,
        });
      }
    }
  }

  await audit("ostrc.submit", "ostrc_responses", athlete.id, {
    week,
    zones: parsed.data.zones.length,
  });
  revalidatePath("/athlete");
  revalidatePath("/athlete/ostrc");
  return { ok: true };
}
