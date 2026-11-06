/**
 * One-off push diagnostics: send a test notification to real subscriptions.
 *   npx tsx --env-file=.env.local scripts/push-test.ts [profile_id]
 * Without profile_id sends to the first subscribed profile found.
 */
import { createClient } from "@supabase/supabase-js";
import { sendPushToProfile } from "../src/lib/push";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("missing supabase env");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  let ids = process.argv.slice(2);
  if (ids.length === 0) {
    const { data: subs } = await sb.from("push_subscriptions").select("profile_id");
    ids = [...new Set((subs ?? []).map((s: { profile_id: string }) => s.profile_id))];
  }
  console.log("profiles with subs:", ids.length);

  for (const pid of ids) {
    try {
      const n = await sendPushToProfile(sb, pid, {
        title: "RallyMonitor test",
        body: "Тестовое уведомление — если вы его видите, push работает",
        url: "/coach",
      });
      console.log(pid.slice(0, 8), "sent:", n);
    } catch (e) {
      console.log(pid.slice(0, 8), "THREW:", (e as Error).message);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
