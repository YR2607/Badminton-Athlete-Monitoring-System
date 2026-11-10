import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { flagEnabled, getFeatureFlags } from "@/lib/flags";
import { todayInTz } from "@/lib/dates";
import { fetchAthleteContext } from "@/lib/ai/context";
import { callAI } from "@/lib/ai/provider";
import { AI_OUTPUT_JSON_SCHEMA, parseAIOutput } from "@/lib/ai/schema";
import { SYSTEM_PROMPT, PROMPT_VERSION, buildUserPrompt } from "@/lib/ai/prompt";
import { verifyEvidence } from "@/lib/ai/verify";
import type { Athlete, FeatureFlag } from "@/lib/types";

/**
 * Daily AI insight generation. External scheduler invokes with
 * `Authorization: Bearer <AI_CRON_SECRET>` once per day.
 * Idempotent: one ai_analysis_runs row per (date, athlete).
 * Uses the service-role client ONLY because there is no user session here;
 * every write lands in ai_* tables — never in athlete records.
 */

const TZ = "Europe/Chisinau";
const MAX_PER_RUN = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.AI_CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: flags } = await admin.from("feature_flags").select("*");
  if (!flagEnabled(((flags as FeatureFlag[]) ?? []).filter((f) => f.key === "ai"), "ai", null))
    return NextResponse.json({ skipped: "ai flag disabled" });

  const today = todayInTz(TZ);
  const { data: done } = await admin
    .from("ai_analysis_runs")
    .select("subject_id")
    .eq("run_date", today)
    .eq("kind", "athlete_daily");
  const doneIds = new Set(((done as { subject_id: string }[]) ?? []).map((r) => r.subject_id));

  const { data: athletes } = await admin
    .from("athletes")
    .select("id")
    .eq("status", "active")
    .limit(MAX_PER_RUN);
  const pending = ((athletes as Pick<Athlete, "id">[]) ?? []).filter((a) => !doneIds.has(a.id));

  const results: { athlete_id: string; status: string }[] = [];
  for (const a of pending) {
    const { data: run } = await admin
      .from("ai_analysis_runs")
      .insert({ run_date: today, kind: "athlete_daily", subject_type: "athlete", subject_id: a.id, status: "running" })
      .select("id")
      .single();
    const runId = (run as { id: string } | null)?.id ?? null;

    const context = await fetchAthleteContext(admin, a.id, TZ, 14);
    if (!context) {
      if (runId) await admin.from("ai_analysis_runs").update({ status: "error", error: "no athlete" }).eq("id", runId);
      results.push({ athlete_id: a.id, status: "no_athlete" });
      continue;
    }

    const res = await callAI({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(context, "ru"),
      jsonSchema: AI_OUTPUT_JSON_SCHEMA,
    });
    if (!res.ok) {
      if (runId) await admin.from("ai_analysis_runs").update({ status: "error", error: res.error }).eq("id", runId);
      results.push({ athlete_id: a.id, status: res.error });
      continue;
    }
    if (res.usage) {
      await admin.from("ai_usage_logs").insert({
        run_id: runId, provider: "openai", model: res.usage.model,
        input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
        endpoint: "cron/ai-analysis",
      });
    }

    const parsed = parseAIOutput(res.data);
    if (!parsed) {
      if (runId) await admin.from("ai_analysis_runs").update({ status: "error", error: "schema_invalid" }).eq("id", runId);
      results.push({ athlete_id: a.id, status: "schema_invalid" });
      continue;
    }
    if (!parsed.insufficient) {
      const v = verifyEvidence(parsed.insight, context);
      if (!v.ok) {
        if (runId)
          await admin
            .from("ai_analysis_runs")
            .update({ status: "error", error: `unverified_evidence:${v.unverified.map((u) => u.metric).join(",")}` })
            .eq("id", runId);
        results.push({ athlete_id: a.id, status: "unverified_evidence" });
        continue;
      }
    }

    await admin.from("ai_insights").insert({
      run_id: runId,
      subject_type: "athlete",
      subject_id: a.id,
      category: parsed.insufficient ? "data_quality" : parsed.insight.category,
      severity: parsed.insufficient ? "info" : parsed.insight.severity,
      title: parsed.insufficient ? "insufficient_data" : parsed.insight.title,
      insight: parsed.insufficient ? null : parsed.insight,
      insufficient: parsed.insufficient,
      reason: parsed.insufficient ? parsed.reason : null,
      model_version: res.usage?.model ?? "unknown",
      prompt_version: PROMPT_VERSION,
    });
    if (runId) await admin.from("ai_analysis_runs").update({ status: "ok" }).eq("id", runId);
    results.push({ athlete_id: a.id, status: parsed.insufficient ? "insufficient" : "ok" });
  }

  return NextResponse.json({ date: today, processed: results.length, results });
}
