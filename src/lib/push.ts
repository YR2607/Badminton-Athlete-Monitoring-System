import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a Web Push to every subscription of a profile. Dead subscriptions
 * (404/410) are removed. No-op when VAPID env vars are missing.
 */
export async function sendPushToProfile(
  admin: SupabaseClient,
  profileId: string,
  payload: PushPayload,
): Promise<number> {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return 0;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:coach@example.com",
    pub,
    priv,
  );

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("profile_id", profileId);
  if (!subs?.length) return 0;

  let sent = 0;
  for (const s of subs as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 12 },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error("push_send_failed", status, (e as Error).message);
      }
    }
  }
  return sent;
}
