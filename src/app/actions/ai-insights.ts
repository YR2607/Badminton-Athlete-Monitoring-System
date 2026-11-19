"use server";

import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { scopedAthleteIds } from "@/lib/coach-data";
import { isFlagEnabled } from "@/lib/flags";
import { fetchAthleteContext, summarizeGroup } from "@/lib/ai/context";
import { callAI, aiModel } from "@/lib/ai/provider";
import { AI_OUTPUT_JSON_SCHEMA, parseAIOutput, type AIInsight } from "@/lib/ai/schema";
import { SYSTEM_PROMPT, PROMPT_VERSION, buildUserPrompt } from "@/lib/ai/prompt";
import { verifyEvidence } from "@/lib/ai/verify";
import { replaceAthleteCodes, resolveInsightNames } from "@/lib/ai/names";
import { isUniqueViolation } from "@/lib/ai/guard";
import { reserveBudget, settleBudget, rateCheck } from "@/lib/ai/budget";
import { estimateCostUsd } from "@/lib/ai/cost";
import { todayInTz } from "@/lib/dates";

export interface InsightRow {
  id: string;
  category: string;
  severity: string;
  title: string;
  insight: unknown;
  insufficient: boolean;
  reason: string | null;
  model_version: string | null;
  prompt_version: string | null;
  generated_at: string;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const err = (e: string): Result<never> => ({ ok: false, error: e });

export interface AnalysisRange {
  from: string;
  to: string;
}

const MAX_SPAN_DAYS = 60;

/** Validate/clamp a client-supplied period; null = invalid input. */
function validRange(range: AnalysisRange, tz: string): AnalysisRange | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(range.from) || !re.test(range.to)) return null;
  let { from, to } = range;
  if (from > to) [from, to] = [to, from];
  const today = todayInTz(tz);
  if (to > today) to = today;
  const span =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (span < 1 || span > MAX_SPAN_DAYS) return null;
  return { from, to };
}

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Claim a run row atomically. On same-day unique conflict reuse the
 * existing run (update -> running) instead of silently running untracked.
 */
async function claimRun(
  supabase: Supa,
  row: { run_date: string; kind: string; subject_type: string; subject_id: string },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ai_analysis_runs")
    .insert({ ...row, status: "running" })
    .select("id")
    .single();
  if (!error && data) return (data as { id: string }).id;
  if (!isUniqueViolation(error)) return null;
  const { data: existing } = await supabase
    .from("ai_analysis_runs")
    .select("id")
    .eq("run_date", row.run_date)
    .eq("kind", row.kind)
    .eq("subject_type", row.subject_type)
    .eq("subject_id", row.subject_id)
    .single();
  const id = (existing as { id: string } | null)?.id ?? null;
  if (id)
    await supabase.from("ai_analysis_runs").update({ status: "running", error: null }).eq("id", id);
  return id;
}

async function staffAthlete(athleteId: string) {
  const me = await getCurrentProfile();
  if (!me || (me.role !== "coach" && me.role !== "admin")) return null;
  const supabase = await createClient();
  const ids = await scopedAthleteIds(supabase);
  if (!ids.includes(athleteId)) return null;
  return { me, supabase };
}

async function fetchNameMap(supabase: Supa, athleteIds: string[]): Promise<Record<string, string>> {
  if (!athleteIds.length) return {};
  const { data: athletes } = await supabase
    .from("athletes")
    .select("athlete_code,profile_id")
    .in("id", athleteIds);
  const rows = (athletes as { athlete_code: string; profile_id: string }[] | null) ?? [];
  const profileIds = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))];
  const { data: profiles } = profileIds.length
    ? await supabase.from("profiles").select("id,display_name").in("id", profileIds)
    : { data: [] };
  const nameByProfile = new Map(
    ((profiles as { id: string; display_name: string }[] | null) ?? []).map((p) => [
      p.id,
      p.display_name,
    ]),
  );
  const out: Record<string, string> = {};
  for (const r of rows) {
    const name = nameByProfile.get(r.profile_id)?.trim();
    if (name && r.athlete_code) out[r.athlete_code] = name;
  }
  return out;
}

function resolveRowNames(row: InsightRow, names: Record<string, string>): InsightRow {
  if (!Object.keys(names).length) return row;
  const insight =
    row.insight && typeof row.insight === "object" && !row.insufficient
      ? resolveInsightNames(row.insight as AIInsight, names)
      : row.insight;
  return {
    ...row,
    title: replaceAthleteCodes(row.title, names),
    reason: row.reason ? replaceAthleteCodes(row.reason, names) : row.reason,
    insight,
  };
}

/** Latest stored insight for the athlete (staff-scoped). */
export async function getLatestInsight(athleteId: string): Promise<Result<InsightRow | null>> {
  const ctx = await staffAthlete(athleteId);
  if (!ctx) return err("forbidden");
  if (!(await isFlagEnabled("ai", null))) return err("disabled");
  const { data } = await ctx.supabase
    .from("ai_insights")
    .select("id,category,severity,title,insight,insufficient,reason,model_version,prompt_version,generated_at")
    .eq("subject_type", "athlete")
    .eq("subject_id", athleteId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data as InsightRow | null) ?? null;
  if (!row) return { ok: true, data: null };
  const names = await fetchNameMap(ctx.supabase, [athleteId]);
  return { ok: true, data: resolveRowNames(row, names) };
}

/**
 * Same-day cache: if an 'ok' run for this subject already produced an
 * insight today, return it — never re-bill OpenAI for an identical ask.
 */
async function cachedInsight(
  supabase: Supa,
  kind: string,
  subjectType: "athlete" | "group",
  subjectId: string,
  runDate: string,
): Promise<InsightRow | null> {
  const { data: run } = await supabase
    .from("ai_analysis_runs")
    .select("id")
    .eq("run_date", runDate)
    .eq("kind", kind)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .eq("status", "ok")
    .maybeSingle();
  if (!run) return null;
  const { data: ins } = await supabase
    .from("ai_insights")
    .select("id,category,severity,title,insight,insufficient,reason,model_version,prompt_version,generated_at")
    .eq("run_id", (run as { id: string }).id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (ins as InsightRow | null) ?? null;
}

/** On-demand analysis: context → provider → validate → verify → persist. */
export async function analyzeAthlete(
  athleteId: string,
  range?: AnalysisRange,
): Promise<Result<InsightRow>> {
  const ctx = await staffAthlete(athleteId);
  if (!ctx) return err("forbidden");
  if (!(await isFlagEnabled("ai", null))) return err("disabled");
  if (!(await rateCheck(ctx.supabase, `ai:analyze:${ctx.me.id}`, 10))) return err("rate_limited");
  const tz = ctx.me.timezone ?? "UTC";
  const period = range ? (validRange(range, tz) ?? undefined) : undefined;
  if (range && !period) return err("invalid_range");
  const kind = period ? `athlete_on_demand:${period.from}:${period.to}` : "athlete_on_demand";
  const cached = await cachedInsight(ctx.supabase, kind, "athlete", athleteId, todayInTz(tz));
  if (cached) {
    const names = await fetchNameMap(ctx.supabase, [athleteId]);
    return { ok: true, data: resolveRowNames(cached, names) };
  }

  const context = await fetchAthleteContext(ctx.supabase, athleteId, tz, 14, period);
  if (!context) return err("not_found");

  const runId = await claimRun(ctx.supabase, {
    run_date: todayInTz(tz),
    kind,
    subject_type: "athlete",
    subject_id: athleteId,
  });

  const model = aiModel();
  const resv = await reserveBudget(ctx.supabase, model);
  if (!resv.ok) {
    if (runId)
      await ctx.supabase.from("ai_analysis_runs").update({ status: "error", error: "budget_exceeded" }).eq("id", runId);
    return err("budget_exceeded");
  }
  const res = await callAI({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(context, ctx.me.preferred_language),
    jsonSchema: AI_OUTPUT_JSON_SCHEMA,
    validate: (d) => parseAIOutput(d) !== null,
  });
  await settleBudget(
    ctx.supabase,
    resv.est,
    res.usage ? (res.usage.cost_usd ?? estimateCostUsd(res.usage.model, res.usage.input_tokens, res.usage.output_tokens)) : 0,
  );
  if (!res.ok) {
    if (runId)
      await ctx.supabase.from("ai_analysis_runs").update({ status: "error", error: res.raw ? `${res.error}|${res.raw}` : res.error }).eq("id", runId);
    return err(res.error);
  }
  let usageFailed = false;
  if (res.usage) {
    const { error: uerr } = await ctx.supabase.from("ai_usage_logs").insert({
      run_id: runId,
      profile_id: ctx.me.id,
      provider: "openai",
      model: res.usage.model,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      endpoint: "actions/analyzeAthlete",
    });
    if (uerr) {
      usageFailed = true;
      console.error("ai_usage_logs insert failed:", uerr.message);
    }
  }

  const parsed = parseAIOutput(res.data);
  if (!parsed) {
    if (runId)
      await ctx.supabase.from("ai_analysis_runs").update({ status: "error", error: `schema_invalid:${JSON.stringify(res.data).slice(0, 180)}` }).eq("id", runId);
    return err("schema_invalid");
  }
  if (!parsed.insufficient && !verifyEvidence(parsed.insight, context).ok) {
    if (runId)
      await ctx.supabase.from("ai_analysis_runs").update({ status: "error", error: "unverified_evidence" }).eq("id", runId);
    return err("unverified_evidence");
  }

  const row = {
    run_id: runId,
    subject_type: "athlete",
    subject_id: athleteId,
    category: parsed.insufficient ? "data_quality" : parsed.insight.category,
    severity: parsed.insufficient ? "info" : parsed.insight.severity,
    title: parsed.insufficient ? "insufficient_data" : parsed.insight.title,
    insight: parsed.insufficient ? null : parsed.insight,
    insufficient: parsed.insufficient,
    reason: parsed.insufficient ? parsed.reason : null,
    model_version: res.usage?.model ?? "unknown",
    prompt_version: PROMPT_VERSION,
  };
  const { data: inserted, error } = await ctx.supabase.from("ai_insights").insert(row).select("id,generated_at").single();
  if (error || !inserted) {
    if (runId)
      await ctx.supabase.from("ai_analysis_runs").update({ status: "error", error: "insert_failed" }).eq("id", runId);
    return err("insert_failed");
  }
  if (runId)
    await ctx.supabase
      .from("ai_analysis_runs")
      .update({ status: "ok", error: usageFailed ? "usage_log_failed" : null })
      .eq("id", runId);
  const names = await fetchNameMap(ctx.supabase, [athleteId]);
  return {
    ok: true,
    data: resolveRowNames(
      {
        id: inserted.id,
        generated_at: inserted.generated_at,
        category: row.category,
        severity: row.severity,
        title: row.title,
        insight: row.insight,
        insufficient: row.insufficient,
        reason: row.reason,
        model_version: row.model_version,
        prompt_version: row.prompt_version,
      } as InsightRow,
      names,
    ),
  };
}

/** Latest stored group insight. */
export async function getLatestGroupInsight(groupId: string): Promise<Result<InsightRow | null>> {
  const me = await getCurrentProfile();
  if (!me || (me.role !== "coach" && me.role !== "admin")) return err("forbidden");
  if (!(await isFlagEnabled("ai", null))) return err("disabled");
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_insights")
    .select("id,category,severity,title,insight,insufficient,reason,model_version,prompt_version,generated_at")
    .eq("subject_type", "group")
    .eq("subject_id", groupId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data as InsightRow | null) ?? null;
  if (!row) return { ok: true, data: null };
  const { data: members } = await supabase
    .from("group_memberships")
    .select("athlete_id")
    .eq("group_id", groupId)
    .is("left_at", null);
  const memberIds = ((members as { athlete_id: string }[] | null) ?? []).map((m) => m.athlete_id);
  const scoped = await scopedAthleteIds(supabase);
  const names = await fetchNameMap(
    supabase,
    memberIds.filter((id) => scoped.includes(id)),
  );
  return { ok: true, data: resolveRowNames(row, names) };
}

/** On-demand team briefing: group context → provider → validate → persist. */
export async function analyzeGroup(
  groupId: string,
  range?: AnalysisRange,
): Promise<Result<InsightRow>> {
  const me = await getCurrentProfile();
  if (!me || (me.role !== "coach" && me.role !== "admin")) return err("forbidden");
  if (!(await isFlagEnabled("ai", null))) return err("disabled");
  const supa0 = await createClient();
  if (!(await rateCheck(supa0, `ai:analyze:${me.id}`, 10))) return err("rate_limited");
  const supabase = await createClient();
  const tz = me.timezone ?? "UTC";
  const period = range ? (validRange(range, tz) ?? undefined) : undefined;
  if (range && !period) return err("invalid_range");
  const kind = period ? `group_briefing:${period.from}:${period.to}` : "group_briefing";
  const cached = await cachedInsight(supabase, kind, "group", groupId, todayInTz(tz));
  if (cached) {
    const { data: members } = await supabase
      .from("group_memberships")
      .select("athlete_id")
      .eq("group_id", groupId)
      .is("left_at", null);
    const ids = ((members as { athlete_id: string }[]) ?? []).map((m) => m.athlete_id);
    const scoped = await scopedAthleteIds(supabase);
    const names = await fetchNameMap(supabase, ids.filter((x) => scoped.includes(x)));
    return { ok: true, data: resolveRowNames(cached, names) };
  }

  const [{ data: group }, { data: members }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", groupId).maybeSingle(),
    supabase.from("group_memberships").select("athlete_id").eq("group_id", groupId).is("left_at", null),
  ]);
  if (!group) return err("not_found");
  const ids = ((members as { athlete_id: string }[]) ?? []).map((m) => m.athlete_id);
  const scoped = await scopedAthleteIds(supabase);
  const contexts = [];
  for (const id of ids.filter((x) => scoped.includes(x)).slice(0, 30)) {
    const c = await fetchAthleteContext(supabase, id, tz, 14, period);
    if (c) contexts.push(c);
  }
  const gctx = summarizeGroup((group as { name: string }).name, contexts);

  const runId = await claimRun(supabase, {
    run_date: todayInTz(tz),
    kind,
    subject_type: "group",
    subject_id: groupId,
  });

  const gmodel = aiModel();
  const gresv = await reserveBudget(supabase, gmodel);
  if (!gresv.ok) {
    if (runId)
      await supabase.from("ai_analysis_runs").update({ status: "error", error: "budget_exceeded" }).eq("id", runId);
    return err("budget_exceeded");
  }
  const res = await callAI({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(gctx, me.preferred_language),
    jsonSchema: AI_OUTPUT_JSON_SCHEMA,
    validate: (d) => parseAIOutput(d) !== null,
  });
  await settleBudget(
    supabase,
    gresv.est,
    res.usage ? (res.usage.cost_usd ?? estimateCostUsd(res.usage.model, res.usage.input_tokens, res.usage.output_tokens)) : 0,
  );
  if (!res.ok) {
    if (runId)
      await supabase.from("ai_analysis_runs").update({ status: "error", error: res.raw ? `${res.error}|${res.raw}` : res.error }).eq("id", runId);
    return err(res.error);
  }
  let usageFailed = false;
  if (res.usage) {
    const { error: uerr } = await supabase.from("ai_usage_logs").insert({
      run_id: runId, profile_id: me.id, provider: "openai", model: res.usage.model,
      input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
      endpoint: "actions/analyzeGroup",
    });
    if (uerr) {
      usageFailed = true;
      console.error("ai_usage_logs insert failed:", uerr.message);
    }
  }
  const parsed = parseAIOutput(res.data);
  if (!parsed) {
    if (runId)
      await supabase.from("ai_analysis_runs").update({ status: "error", error: `schema_invalid:${JSON.stringify(res.data).slice(0, 180)}` }).eq("id", runId);
    return err("schema_invalid");
  }
  if (!parsed.insufficient && !verifyEvidence(parsed.insight, gctx).ok) {
    if (runId)
      await supabase.from("ai_analysis_runs").update({ status: "error", error: "unverified_evidence" }).eq("id", runId);
    return err("unverified_evidence");
  }

  const row = {
    run_id: runId, subject_type: "group", subject_id: groupId,
    category: parsed.insufficient ? "team" : parsed.insight.category,
    severity: parsed.insufficient ? "info" : parsed.insight.severity,
    title: parsed.insufficient ? "insufficient_data" : parsed.insight.title,
    insight: parsed.insufficient ? null : parsed.insight,
    insufficient: parsed.insufficient,
    reason: parsed.insufficient ? parsed.reason : null,
    model_version: res.usage?.model ?? "unknown",
    prompt_version: PROMPT_VERSION,
  };
  const { data: inserted, error } = await supabase.from("ai_insights").insert(row).select("id,generated_at").single();
  if (error || !inserted) return err("insert_failed");
  if (runId)
    await supabase
      .from("ai_analysis_runs")
      .update({ status: "ok", error: usageFailed ? "usage_log_failed" : null })
      .eq("id", runId);
  const names = await fetchNameMap(supabase, ids.filter((x) => scoped.includes(x)));
  return {
    ok: true,
    data: resolveRowNames(
      { id: inserted.id, generated_at: inserted.generated_at, ...row } as InsightRow,
      names,
    ),
  };
}

/** Coach thumbs feedback on an insight (upsert per profile). */
export async function sendInsightFeedback(insightId: string, rating: 1 | -1) {
  const me = await getCurrentProfile();
  if (!me || (me.role !== "coach" && me.role !== "admin")) return err("forbidden");
  if (!(await isFlagEnabled("ai", null))) return err("disabled");
  const supabase = await createClient();
  const { error } = await supabase.from("ai_insight_feedback").upsert(
    { insight_id: insightId, profile_id: me.id, rating },
    { onConflict: "insight_id,profile_id" },
  );
  return error ? err(error.message) : { ok: true as const, data: null };
}
