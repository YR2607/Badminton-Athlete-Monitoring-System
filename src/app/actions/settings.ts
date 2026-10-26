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
