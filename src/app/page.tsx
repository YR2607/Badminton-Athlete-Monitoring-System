import { redirect } from "next/navigation";
import { getCurrentProfile, homeForRole } from "@/lib/auth";

export default async function Home() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  redirect(homeForRole(profile.role));
}
