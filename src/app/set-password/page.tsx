import { redirect } from "next/navigation";
import { getCurrentProfile, homeForRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/i18n";
import { SetPasswordForm } from "./set-password-form";

export default async function SetPasswordPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.app_metadata?.must_change_password !== true) {
    redirect(homeForRole(profile.role));
  }

  const dict = getDictionary(profile.preferred_language);
  return <SetPasswordForm dict={dict} />;
}
