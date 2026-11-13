import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data: post } = await sb.from("post_training_checkins")
    .select("id, athlete_id, submitted_at, training_session_id")
    .gte("submitted_at", "2026-11-13T18:00:00Z").lt("submitted_at", "2026-11-13T19:00:00Z").order("submitted_at");
  for (const p of post ?? []) {
    const { data: s } = await sb.from("training_sessions").select("session_rpe, duration_minutes, started_at, client_uuid").eq("id", p.training_session_id).single();
    console.log(`post ${p.submitted_at} a=${p.athlete_id.slice(0,8)} -> rpe=${s?.session_rpe} min=${s?.duration_minutes} started=${s?.started_at}`);
  }
  const { data: audit } = await sb.from("audit_logs").select("created_at, action, actor_profile_id")
    .gte("created_at", "2026-11-13T18:00:00Z").lt("created_at", "2026-11-13T19:00:00Z").order("created_at");
  for (const a of audit ?? []) console.log(`audit ${a.created_at} ${a.action} actor=${a.actor_profile_id?.slice(0,8)}`);
}
main();
