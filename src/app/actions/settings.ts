"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, audit } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/dates";
import type { ActionResult } from "@/app/actions/checkins";

/** Users may only change these own-profile fields (role is not editable). */
export async function updateOwnSettings(input: {
  display_name?: string;
  preferred_language?: string;
  timezone?: string;
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
  if (Object.keys(patch).length === 0) return { error: "validation" };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(patch).eq("id", profile.id);
  if (error) return { error: error.message };
  await audit("profile.update", "profiles", profile.id, patch);
  revalidatePath("/");
  return { ok: true };
}
