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
