"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { homeForRole } from "@/lib/auth";
import type { AppRole } from "@/lib/types";

export async function signIn(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "invalid_credentials" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user!.id)
    .single();
  redirect(homeForRole((profile?.role as AppRole) ?? "athlete"));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}

export async function requestPasswordReset(
  _prev: { ok?: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "invalid_credentials" };
  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });
  // Always report success to avoid account enumeration.
  return { ok: true };
}

export async function updatePassword(
  _prev: { ok?: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "weak_password" };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: true };
}

/** Admin-only: provision a user and (for athletes) their athlete row. */
export async function adminCreateUser(input: {
  email: string;
  password: string;
  display_name: string;
  role: AppRole;
  preferred_language?: string;
  timezone?: string;
  athlete_code?: string;
  birth_year?: number;
}): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };
  const { data: me } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("user_id", user.id)
    .single();
  if (me?.role !== "admin") return { error: "forbidden" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.toLowerCase().trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: {
      display_name: input.display_name,
      role: input.role,
      preferred_language: input.preferred_language ?? "ru",
      timezone: input.timezone ?? "Europe/Chisinau",
      athlete_code: input.athlete_code,
      birth_year: input.birth_year,
    },
  });
  if (error) return { error: error.message };

  await admin.from("audit_logs").insert({
    actor_profile_id: me.id,
    action: "user.create",
    target_type: "auth.user",
    target_id: data.user.id,
    metadata: { role: input.role, email: input.email },
  });
  return { ok: true };
}
