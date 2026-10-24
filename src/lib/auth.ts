import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Athlete, Profile } from "@/lib/types";

export function homeForRole(role: AppRole): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "coach":
      return "/coach";
    default:
      return "/athlete";
  }
}

/** Per-request memoized — layout and page share one auth+profile round trip. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
});

export async function requireRole(roles: AppRole | AppRole[]): Promise<Profile> {
  const allowed = Array.isArray(roles) ? roles : [roles];
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!allowed.includes(profile.role)) redirect(homeForRole(profile.role));
  return profile;
}

export const getCurrentAthlete = cache(async (): Promise<Athlete | null> => {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const { data } = await supabase
    .from("athletes")
    .select("*")
    .eq("profile_id", profile.id)
    .maybeSingle();
  return (data as Athlete | null) ?? null;
});

/** Audit a sensitive action. Non-blocking; failures are logged, not thrown. */
export async function audit(
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    const profile = await getCurrentProfile();
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    await admin.from("audit_logs").insert({
      actor_profile_id: profile?.id ?? null,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
    });
  } catch (e) {
    console.error("audit_log_failed", action, e);
  }
}
