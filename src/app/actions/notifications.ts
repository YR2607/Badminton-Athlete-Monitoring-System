"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedUserId } from "@/lib/auth";

export async function markAllRead() {
  const supabase = await createClient();
  const userId = await getVerifiedUserId(supabase);
  if (!userId) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .single();
  if (!profile) return;
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .is("read_at", null);
  revalidatePath("/", "layout");
}
