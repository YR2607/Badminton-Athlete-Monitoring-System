"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, audit } from "@/lib/auth";
import { coachNoteSchema, alertReviewSchema } from "@/lib/validation";
import { evaluateAthleteDay } from "@/lib/evaluate";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate } from "@/lib/dates";

export type ActionResult = { ok?: boolean; error?: string };

export async function addCoachNote(input: unknown): Promise<ActionResult> {
  const parsed = coachNoteSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.from("coach_notes").insert({
    athlete_id: parsed.data.athlete_id,
    coach_profile_id: profile.id,
    kind: parsed.data.kind,
    note: parsed.data.note,
  });
  if (error) return { error: error.message };
  await audit("note.create", "coach_notes", parsed.data.athlete_id, { kind: parsed.data.kind });
  revalidatePath(`/coach/athletes/${parsed.data.athlete_id}`);
  return { ok: true };
}

export async function reviewAlert(input: unknown): Promise<ActionResult> {
  const parsed = alertReviewSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alerts")
    .update({
      status: parsed.data.status,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      resolution_note: parsed.data.resolution_note ?? null,
    })
    .eq("id", parsed.data.alert_id)
    .select("id, athlete_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "forbidden" };
  await audit("alert.review", "alerts", parsed.data.alert_id, { status: parsed.data.status });
  revalidatePath("/coach");
  revalidatePath("/coach/alerts");
  return { ok: true };
}

/** Re-run the rules engine for an athlete (e.g. after data corrections). */
export async function reevaluateAthlete(athleteId: string, date: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };
  const supabase = await createClient();
  // RLS check: coach can only touch assigned athletes (the select will be empty otherwise).
  const { data: a } = await supabase
    .from("athletes")
    .select("id, profile:profiles(timezone)")
    .eq("id", athleteId)
    .maybeSingle();
  if (!a) return { error: "forbidden" };
  const tz = (a as { profile?: { timezone?: string } }).profile?.timezone ?? "UTC";
  await evaluateAthleteDay(createAdminClient(), athleteId, date || localDate(new Date(), tz), tz);
  revalidatePath("/coach");
  return { ok: true };
}
