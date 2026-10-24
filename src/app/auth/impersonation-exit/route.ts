import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Exit "Sign in as" mode: restore the admin session stashed in the
 * rm-impersonator cookie, then drop both helper cookies. If the stashed
 * session is already dead the user lands on "/" and gets sent to /login —
 * same as a normal sign-out.
 */
export async function GET(request: Request) {
  const store = await cookies();
  const raw = store.get("rm-impersonator")?.value;

  if (raw) {
    try {
      const { at, rt } = JSON.parse(decodeURIComponent(raw)) as {
        at?: string;
        rt?: string;
      };
      if (at && rt) {
        const supabase = await createClient();
        await supabase.auth.setSession({ access_token: at, refresh_token: rt });
      }
    } catch {
      // corrupted cookie — fall through to the redirect
    }
  }

  const res = NextResponse.redirect(new URL("/", request.url));
  res.cookies.delete("rm-impersonator");
  res.cookies.delete("rm-impersonating");
  return res;
}
