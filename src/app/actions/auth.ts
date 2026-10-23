"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { homeForRole } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/dates";
import { createUserSchema } from "@/lib/validation";
import type { AppRole } from "@/lib/types";

/** Athletes log in by their code (ATH-001 → ath-001@rally.local); coaches/admins by email. */
function loginToEmail(login: string): string {
  const v = login.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@rally.local`;
}

function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous 0/o, 1/l/i
  const rand = crypto.getRandomValues(new Uint32Array(8));
  const part = (off: number) =>
    Array.from({ length: 4 }, (_, i) => chars[rand[off + i] % chars.length]).join("");
  return `Rally-${part(0)}-${part(4)}`;
}

export async function signIn(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = loginToEmail(String(formData.get("login") ?? ""));
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.code === "user_banned" || /banned/i.test(error.message) ? "banned" : "invalid_credentials" };
  }

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
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
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

/**
 * Admin-only: provision a user and (for athletes) their athlete row.
 * Athletes need no real email — their login is the athlete code.
 */
export async function adminCreateUser(input: {
  email?: string;
  password: string;
  display_name: string;
  role: AppRole;
  preferred_language?: string;
  timezone?: string;
  athlete_code?: string;
  birth_year?: number;
}): Promise<{ ok?: boolean; error?: string; athleteId?: string }> {
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

  const parsed = createUserSchema.safeParse({
    ...input,
    email: input.email?.trim() || undefined,
    athlete_code: input.athlete_code?.trim() || undefined,
  });
  if (!parsed.success) return { error: "validation" };
  if (!isValidTimeZone(parsed.data.timezone)) return { error: "validation" };

  const code = parsed.data.athlete_code;
  // Athletes always log in by code, so their auth email is always the derived
  // code address — a provided email would silently break code login.
  const email =
    parsed.data.role === "athlete"
      ? loginToEmail(code!)
      : parsed.data.email!.toLowerCase();

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      display_name: parsed.data.display_name,
      role: parsed.data.role,
      preferred_language: parsed.data.preferred_language,
      timezone: parsed.data.timezone,
      athlete_code: code,
      birth_year: parsed.data.birth_year,
    },
  });
  if (error) return { error: error.message };

  await admin.from("audit_logs").insert({
    actor_profile_id: me.id,
    action: "user.create",
    target_type: "auth.user",
    target_id: data.user.id,
    metadata: { role: parsed.data.role, email },
  });

  let athleteId: string | undefined;
  if (parsed.data.role === "athlete") {
    const { data: prof } = await admin
      .from("profiles")
      .select("id")
      .eq("user_id", data.user.id)
      .single();
    const { data: athlete } = prof
      ? await admin.from("athletes").select("id").eq("profile_id", prof.id).single()
      : { data: null };
    athleteId = athlete?.id;
  }
  return { ok: true, athleteId };
}

/**
 * Admin-only: set a new password for any user. Returns the generated
 * password once so the admin can hand it to the athlete/parent.
 */
export async function adminResetUserPassword(
  profileId: string,
): Promise<{ ok?: boolean; error?: string; password?: string }> {
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
  const { data: target } = await admin
    .from("profiles")
    .select("user_id")
    .eq("id", profileId)
    .single();
  if (!target) return { error: "not_found" };

  const password = generatePassword();
  const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
  if (error) return { error: error.message };

  await admin.from("audit_logs").insert({
    actor_profile_id: me.id,
    action: "user.password_reset",
    target_type: "profile",
    target_id: profileId,
    metadata: {},
  });
  return { ok: true, password };
}

/**
 * Admin-only: sign in as another user. Generates a one-time magic link whose
 * action_link lands on /auth/callback and establishes the target's session —
 * the admin's own session is replaced, so getting back means signing in again.
 */
export async function adminImpersonate(
  profileId: string,
): Promise<{ ok?: boolean; error?: string; url?: string }> {
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
  if (me.id === profileId) return { error: "self" };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("user_id, role")
    .eq("id", profileId)
    .single();
  if (!target) return { error: "not_found" };
  if (target.role === "admin") return { error: "forbidden" };

  const { data: targetUser } = await admin.auth.admin.getUserById(target.user_id);
  const email = targetUser?.user?.email;
  if (!email) return { error: "not_found" };

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${origin}/auth/callback` },
  });
  const url = data?.properties?.action_link;
  if (error || !url) return { error: error?.message ?? "failed" };

  await admin.from("audit_logs").insert({
    actor_profile_id: me.id,
    action: "user.impersonate",
    target_type: "profile",
    target_id: profileId,
    metadata: {},
  });
  return { ok: true, url };
}

/**
 * Admin-only: permanently delete a user. The auth.users row is removed,
 * which cascades to profiles → athletes → check-ins/sessions/alerts.
 * Guards: cannot delete yourself or any admin-role profile (prevents
 * locking the club out of the admin account).
 */
export async function adminDeleteUser(
  profileId: string,
): Promise<{ ok?: boolean; error?: string }> {
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
  if (me.id === profileId) return { error: "self_delete" };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("user_id, role")
    .eq("id", profileId)
    .single();
  if (!target) return { error: "not_found" };
  if (target.role === "admin") return { error: "forbidden" };

  const { error } = await admin.auth.admin.deleteUser(target.user_id);
  if (error) return { error: error.message };

  await admin.from("audit_logs").insert({
    actor_profile_id: me.id,
    action: "user.delete",
    target_type: "profile",
    target_id: profileId,
    metadata: { role: target.role },
  });
  revalidatePath("/admin/users");
  return { ok: true };
}
