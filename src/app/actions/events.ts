"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentAthlete, audit } from "@/lib/auth";
import { calendarEventSchema } from "@/lib/validation";

export type ActionResult = { ok?: boolean; error?: string };

const ATHLETE_KINDS = ["competition", "school", "vacation", "other"] as const;

/** Coach/admin adds an event for an athlete or a whole group (RLS checks access). */
export async function saveCalendarEvent(input: unknown): Promise<ActionResult> {
  const parsed = calendarEventSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .insert({
      athlete_id: parsed.data.athlete_id ?? null,
      group_id: parsed.data.group_id ?? null,
      kind: parsed.data.kind,
      title: parsed.data.title,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      created_by: profile.id,
    })
    .select("id, athlete_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "forbidden" };
  await audit("event.create", "calendar_events", data.id, { kind: parsed.data.kind });
  if (data.athlete_id) revalidatePath(`/coach/athletes/${data.athlete_id}`);
  revalidatePath("/athlete");
  return { ok: true };
}

/** Coach/admin deletes an athlete/group event (RLS enforces access). */
export async function deleteCalendarEvent(eventId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return { error: "forbidden" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", eventId)
    .select("id, athlete_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "forbidden" };
  await audit("event.delete", "calendar_events", eventId, {});
  if (data.athlete_id) revalidatePath(`/coach/athletes/${data.athlete_id}`);
  return { ok: true };
}

/** Athlete logs own event (school/vacation/competition/other — not illness). */
export async function saveOwnEvent(input: unknown): Promise<ActionResult> {
  const parsed = calendarEventSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const athlete = await getCurrentAthlete();
  if (!athlete) return { error: "forbidden" };
  if (!(ATHLETE_KINDS as readonly string[]).includes(parsed.data.kind)) {
    return { error: "validation" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("calendar_events").insert({
    athlete_id: athlete.id,
    group_id: null,
    kind: parsed.data.kind,
    title: parsed.data.title,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date,
    created_by: athlete.profile_id,
  });
  if (error) return { error: error.message };
  await audit("event.self_create", "calendar_events", athlete.id, { kind: parsed.data.kind });
  revalidatePath("/athlete");
  return { ok: true };
}

/** Athlete deletes an event they created (RLS limits to own + created_by). */
export async function deleteOwnEvent(eventId: string): Promise<ActionResult> {
  const athlete = await getCurrentAthlete();
  if (!athlete) return { error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", eventId)
    .eq("athlete_id", athlete.id);
  if (error) return { error: error.message };
  revalidatePath("/athlete");
  return { ok: true };
}
