"use server";

import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { scopedAthleteIds } from "@/lib/coach-data";
import { fetchAthleteContext, type AthleteContext } from "@/lib/ai/context";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import type { Alert, FieldTest, FieldTestResult, GrowthMeasurement, TrainingSession } from "@/lib/types";

/**
 * Read-only AI tools. Every function verifies identity, role and scope.
 * Returns data for the AI layer — never exposes unrestricted querying.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function staffContext() {
  const me = await getCurrentProfile();
  if (!me || (me.role !== "coach" && me.role !== "admin")) return null;
  if (!checkRateLimit(`ai:${me.id}`, 60, 60_000)) return null;
  const supabase = await createClient();
  return { me, supabase };
}

async function scopedAthlete(supabase: Awaited<ReturnType<typeof createClient>>, athleteId: string) {
  const ids = await scopedAthleteIds(supabase);
  return ids.includes(athleteId);
}

const err = (e: string): Result<never> => ({ ok: false, error: e });

export async function getAthleteSummary(athleteId: string): Promise<Result<AthleteContext>> {
  const ctx = await staffContext();
  if (!ctx) return err("forbidden");
  if (!(await scopedAthlete(ctx.supabase, athleteId))) return err("no_access");
  const data = await fetchAthleteContext(ctx.supabase, athleteId, ctx.me.timezone ?? "UTC");
  return data ? { ok: true, data } : err("not_found");
}

export async function getAthleteTrends(
  athleteId: string,
  days = 30,
): Promise<Result<AthleteContext>> {
  const ctx = await staffContext();
  if (!ctx) return err("forbidden");
  if (!(await scopedAthlete(ctx.supabase, athleteId))) return err("no_access");
  const data = await fetchAthleteContext(
    ctx.supabase,
    athleteId,
    ctx.me.timezone ?? "UTC",
    Math.min(90, Math.max(7, days)),
  );
  return data ? { ok: true, data } : err("not_found");
}

export async function getGroupSummary(groupId: string) {
  const ctx = await staffContext();
  if (!ctx) return err("forbidden");
  const { data: members } = await ctx.supabase
    .from("group_memberships")
    .select("athlete_id")
    .eq("group_id", groupId)
    .is("left_at", null);
  const ids = ((members as { athlete_id: string }[]) ?? []).map((m) => m.athlete_id);
  const scoped = await scopedAthleteIds(ctx.supabase);
  const allowed = ids.filter((id) => scoped.includes(id));
  const summaries: AthleteContext[] = [];
  for (const id of allowed.slice(0, 30)) {
    const c = await fetchAthleteContext(ctx.supabase, id, ctx.me.timezone ?? "UTC");
    if (c) summaries.push(c);
  }
  return { ok: true, data: { group_id: groupId, athletes: summaries } };
}

export async function getAlertEvidence(athleteId: string) {
  const ctx = await staffContext();
  if (!ctx) return err("forbidden");
  if (!(await scopedAthlete(ctx.supabase, athleteId))) return err("no_access");
  const { data } = await ctx.supabase
    .from("alerts")
    .select("rule_code,severity,triggered_at,evidence,recommendation")
    .eq("athlete_id", athleteId)
    .eq("status", "open")
    .order("triggered_at", { ascending: false })
    .limit(20);
  return { ok: true, data: (data as Partial<Alert>[]) ?? [] };
}

export async function getLoadAnalysis(athleteId: string, days = 14) {
  const ctx = await staffContext();
  if (!ctx) return err("forbidden");
  if (!(await scopedAthlete(ctx.supabase, athleteId))) return err("no_access");
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await ctx.supabase
    .from("training_sessions")
    .select("started_at,duration_minutes,session_rpe,session_load")
    .eq("athlete_id", athleteId)
    .gte("started_at", since)
    .order("started_at");
  return { ok: true, data: (data as Partial<TrainingSession>[]) ?? [] };
}

export async function getDataQuality(athleteId: string) {
  const ctx = await staffContext();
  if (!ctx) return err("forbidden");
  if (!(await scopedAthlete(ctx.supabase, athleteId))) return err("no_access");
  const c = await fetchAthleteContext(ctx.supabase, athleteId, ctx.me.timezone ?? "UTC", 14);
  if (!c) return err("not_found");
  return {
    ok: true,
    data: {
      checkin_coverage_pct: c.wellbeing.coverage_pct,
      checkins_14d: c.wellbeing.checkins,
      post_training_14d: c.post_training.checkins,
      sessions_14d: c.load.sessions,
      baseline_confidence: c.readiness.confidence,
      baseline_input_count: c.readiness.input_data_count,
    },
  };
}

export async function getDevelopmentMetrics(athleteId: string) {
  const ctx = await staffContext();
  if (!ctx) return err("forbidden");
  if (!(await scopedAthlete(ctx.supabase, athleteId))) return err("no_access");
  const [{ data: results }, { data: tests }, { data: growth }] = await Promise.all([
    ctx.supabase
      .from("field_test_results")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("test_date", { ascending: false })
      .limit(50),
    ctx.supabase.from("field_tests").select("*").eq("active", true),
    ctx.supabase
      .from("growth_measurements")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("measured_on", { ascending: false })
      .limit(12),
  ]);
  const byId = new Map(((tests as FieldTest[]) ?? []).map((t) => [t.id, t]));
  return {
    ok: true,
    data: {
      results: ((results as FieldTestResult[]) ?? []).map((r) => ({
        code: byId.get(r.test_id)?.code ?? "test",
        unit: byId.get(r.test_id)?.unit ?? "",
        value: r.value,
        date: r.test_date,
      })),
      growth: (growth as GrowthMeasurement[]) ?? [],
    },
  };
}
