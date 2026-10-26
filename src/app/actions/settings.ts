"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, audit } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/dates";
import type { ActionResult } from "@/app/actions/checkins";

/** Users may only change these own-profile fields (role is not editable). */
export async function updateOwnSettings(input: {
  display_name?: string;
  preferred_language?: string;
  timezone?: string;
  racket_hand?: string;
}): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "unauthenticated" };

  const patch: Record<string, string> = {};
  if (input.display_name?.trim()) patch.display_name = input.display_name.trim().slice(0, 120);
  if (input.preferred_language && ["ru", "ro", "en"].includes(input.preferred_language)) {
    patch.preferred_language = input.preferred_language;
  }
  if (input.timezone && isValidTimeZone(input.timezone)) {
    patch.timezone = input.timezone;
  }
  if (Object.keys(patch).length === 0 && !input.racket_hand) return { error: "validation" };

  const supabase = await createClient();
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("profiles").update(patch).eq("id", profile.id);
    if (error) return { error: error.message };
  }
  if (input.racket_hand && ["right", "left"].includes(input.racket_hand)) {
    const admin = createAdminClient();
    await admin
      .from("athletes")
      .update({ racket_hand: input.racket_hand })
      .eq("profile_id", profile.id);
  }
  await audit("profile.update", "profiles", profile.id, { ...patch, racket_hand: input.racket_hand });
  revalidatePath("/");
  return { ok: true };
}

const DISCIPLINES = ["MS", "WS", "MD", "WD", "XD"];
const PLAY_STYLES = ["attacking", "defensive", "net", "allround"];

/** Athlete's own light card: game profile, goal, equipment, photo path. */
export async function updateOwnAthleteCard(input: {
  preferred_discipline?: string | null;
  play_style?: string | null;
  season_goal?: string | null;
  racket_model?: string | null;
  string_tension_kg?: number | null;
  restrung_on?: string | null;
  photo_path?: string | null;
}): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "unauthenticated" };
  const admin = createAdminClient();
  const { data: athlete } = await admin
    .from("athletes")
    .select("id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!athlete) return { error: "not_found" };

  const patch: Record<string, unknown> = {};
  if (input.preferred_discipline !== undefined) {
    patch.preferred_discipline = DISCIPLINES.includes(input.preferred_discipline ?? "")
      ? input.preferred_discipline
      : null;
  }
  if (input.play_style !== undefined) {
    patch.play_style = PLAY_STYLES.includes(input.play_style ?? "") ? input.play_style : null;
  }
  if (input.season_goal !== undefined) {
    patch.season_goal = (input.season_goal ?? "").trim().slice(0, 200) || null;
  }
  if (input.racket_model !== undefined) {
    patch.racket_model = (input.racket_model ?? "").trim().slice(0, 120) || null;
  }
  if (input.string_tension_kg !== undefined) {
    const v = input.string_tension_kg;
    patch.string_tension_kg =
      typeof v === "number" && v >= 8 && v <= 20 ? Math.round(v * 10) / 10 : null;
  }
  if (input.restrung_on !== undefined) {
    patch.restrung_on = /^\d{4}-\d{2}-\d{2}$/.test(input.restrung_on ?? "")
      ? input.restrung_on
      : null;
  }
  if (input.photo_path !== undefined) {
    // Only the canonical own-folder path is accepted — no arbitrary URLs.
    patch.photo_path =
      input.photo_path === `${athlete.id}/avatar.jpg` ? input.photo_path : null;
  }

  const { error } = await admin.from("athletes").update(patch).eq("id", athlete.id);
  if (error) return { error: error.message };
  await audit("athlete.card_update", "athletes", athlete.id, patch);
  revalidatePath("/athlete/settings");
  revalidatePath("/athlete");
  return { ok: true };
}
