"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { z } from "zod";

const subSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
  user_agent: z.string().max(300).optional(),
});

export async function savePushSubscription(input: unknown) {
  const parsed = subSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile) return { error: "forbidden" };

  // Phase 10: minors' push subscriptions need a granted parental consent.
  if (profile.role === "athlete") {
    const supabase0 = await createClient();
    const { data: ath } = await supabase0
      .from("athletes")
      .select("id")
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (ath) {
      const { data: consent } = await supabase0
        .from("consent_records")
        .select("status")
        .eq("athlete_id", ath.id)
        .eq("consent_type", "parental_data_processing")
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (consent?.status !== "granted") return { error: "consent_required" };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { profile_id: profile.id, ...parsed.data },
    { onConflict: "endpoint" },
  );
  return error ? { error: error.message } : { ok: true };
}

export async function removePushSubscription(endpoint: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "forbidden" };
  const supabase = await createClient();
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("profile_id", profile.id);
  return { ok: true };
}
