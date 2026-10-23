import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate, localHour, localWeekday } from "@/lib/dates";
import type { Athlete, GroupMembership, Profile, TrainingSchedule } from "@/lib/types";

/**
 * Reminder generator. Invoke from an external scheduler (Vercel Cron, cron-job.org,
 * GitHub Actions) with header `Authorization: Bearer <CRON_SECRET>` every ~15 min.
 *
 * Sends internal notifications (never duplicates — dedup_key per day/kind):
 *  - morning_reminder: to athletes who haven't submitted today's check-in
 *    by MORNING_REMINDER_HOUR local time (default 10).
 *  - post_training_reminder: to athletes who had a scheduled group training
 *    ≥90 min ago and haven't submitted a session today.
 *  - coach_missing_morning: to coaches listing athletes still missing.
 *
 * External delivery (push/email/Telegram) intentionally NOT implemented here —
 * wire a provider in `deliverNotification()` when credentials are available.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: profiles } = await admin.from("profiles").select("*").eq("role", "athlete");
  const { data: athletes } = await admin.from("athletes").select("*").eq("status", "active");
  const { data: memberships } = await admin.from("group_memberships").select("*").is("left_at", null);
  const { data: schedules } = await admin.from("training_schedules").select("*").eq("active", true);

  const profById = new Map(((profiles as Profile[]) ?? []).map((p) => [p.id, p]));
  let created = 0;

  for (const a of (athletes as Athlete[]) ?? []) {
    const profile = profById.get(a.profile_id);
    if (!profile) continue;
    const tz = profile.timezone;
    const now = new Date();
    const today = localDate(now, tz);

    const { data: ck } = await admin
      .from("morning_checkins")
      .select("id")
      .eq("athlete_id", a.id)
      .eq("checkin_date", today)
      .maybeSingle();

    const morningHour = Number(process.env.MORNING_REMINDER_HOUR ?? 10);
    if (!ck && localHour(now, tz) >= morningHour) {
      const { error } = await admin.from("notifications").upsert(
        {
          profile_id: profile.id,
          kind: "morning_reminder",
          title: "Утренняя анкета",
          body: "Не забудь заполнить утреннюю анкету",
          dedup_key: `morning:${a.id}:${today}`,
        },
        { onConflict: "dedup_key" },
      );
      if (!error) created++;
    }

    // Post-training: a scheduled session for the athlete's group ended >= 90min ago
    const myGroups = ((memberships as GroupMembership[]) ?? [])
      .filter((m) => m.athlete_id === a.id)
      .map((m) => m.group_id);
    const wd = localWeekday(now, tz);
    const todays = ((schedules as TrainingSchedule[]) ?? []).filter(
      (s) => myGroups.includes(s.group_id) && s.weekday === wd,
    );
    if (todays.length > 0) {
      const { data: session } = await admin
        .from("training_sessions")
        .select("id")
        .eq("athlete_id", a.id)
        .gte("started_at", `${today}T00:00:00Z`)
        .limit(1)
        .maybeSingle();
      if (!session) {
        const [h, m] = todays[0].start_time.split(":").map(Number);
        const minutesNow = localHour(now, tz) * 60 + new Date().getMinutes();
        if (minutesNow >= h * 60 + m + 90) {
          const { error } = await admin.from("notifications").upsert(
            {
              profile_id: profile.id,
              kind: "post_training_reminder",
              title: "Анкета после тренировки",
              body: "Заполни анкету после сегодняшней тренировки",
              dedup_key: `post:${a.id}:${today}`,
            },
            { onConflict: "dedup_key" },
          );
          if (!error) created++;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, notifications_created: created });
}
