import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate, localDayUtcBounds, localMinutesOfDay, localWeekday } from "@/lib/dates";
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
 *  - missing_morning alert rule: recorded for athletes still missing a
 *    check-in after the rule's after_local_hour (default 12).
 *
 * External delivery (push/email/Telegram) intentionally NOT implemented here —
 * wire a provider in `deliverNotification()` when credentials are available.
 */

const TXT: Record<string, Record<string, { title: string; body: string }>> = {
  morning_reminder: {
    ru: { title: "Утренняя анкета", body: "Не забудь заполнить утреннюю анкету" },
    en: { title: "Morning check-in", body: "Don't forget to fill in your morning check-in" },
    ro: { title: "Chestionarul de dimineață", body: "Nu uita să completezi chestionarul de dimineață" },
  },
  post_training_reminder: {
    ru: { title: "Анкета после тренировки", body: "Заполни анкету после сегодняшней тренировки" },
    en: { title: "Post-training check-in", body: "Please fill in the check-in after today's session" },
    ro: { title: "Chestionar post-antrenament", body: "Completează chestionarul după antrenamentul de azi" },
  },
};

const text = (kind: string, lang: string) => TXT[kind]?.[lang] ?? TXT[kind]?.ru ?? { title: kind, body: "" };

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [profiles, athletes, memberships, schedules, missingRule] = await Promise.all([
    admin.from("profiles").select("*").eq("role", "athlete"),
    admin.from("athletes").select("*").eq("status", "active"),
    admin.from("group_memberships").select("*").is("left_at", null),
    admin.from("training_schedules").select("*").eq("active", true),
    admin
      .from("alert_rules")
      .select("severity, params")
      .eq("code", "missing_morning")
      .eq("enabled", true)
      .maybeSingle(),
  ]);
  const readError = profiles.error ?? athletes.error ?? memberships.error ?? schedules.error;
  if (readError) {
    return NextResponse.json({ error: "db_read_failed" }, { status: 500 });
  }

  const profById = new Map(((profiles.data as Profile[] | null) ?? []).map((p) => [p.id, p]));
  const missingAfter =
    Number((missingRule.data?.params as { after_local_hour?: number } | null)?.after_local_hour ?? 12) * 60;
  let created = 0;

  for (const a of (athletes.data as Athlete[] | null) ?? []) {
    const profile = profById.get(a.profile_id);
    if (!profile) continue;
    const tz = profile.timezone;
    const now = new Date();
    const today = localDate(now, tz);
    const minutesNow = localMinutesOfDay(now, tz);

    const { data: ck } = await admin
      .from("morning_checkins")
      .select("id")
      .eq("athlete_id", a.id)
      .eq("checkin_date", today)
      .maybeSingle();

    const morningHour = Number(process.env.MORNING_REMINDER_HOUR ?? 10);
    if (!ck && minutesNow >= morningHour * 60) {
      const t = text("morning_reminder", profile.preferred_language);
      const { data: inserted, error } = await admin.from("notifications").upsert(
        {
          profile_id: profile.id,
          kind: "morning_reminder",
          title: t.title,
          body: t.body,
          dedup_key: `morning:${a.id}:${today}`,
        },
        { onConflict: "dedup_key", ignoreDuplicates: true },
      ).select("id");
      if (!error) created += inserted?.length ?? 0;
    }

    // missing_morning alert rule: no check-in after the configured local hour.
    if (!ck && missingRule.data && minutesNow >= missingAfter) {
      await admin.rpc("record_alert", {
        p_athlete_id: a.id,
        p_rule_code: "missing_morning",
        p_severity: missingRule.data.severity,
        p_evidence: { date: today, local_minutes: minutesNow },
        p_recommendation:
          "Утренняя анкета не заполнена к полудню. Уточнить у спортсмена, всё ли в порядке.",
        p_dedup_key: `${a.id}:missing_morning:${today}`,
      });
    }

    // Post-training: a scheduled session for the athlete's group ended >= 90min ago
    const myGroups = ((memberships.data as GroupMembership[] | null) ?? [])
      .filter((m) => m.athlete_id === a.id)
      .map((m) => m.group_id);
    const wd = localWeekday(now, tz);
    const todays = ((schedules.data as TrainingSchedule[] | null) ?? []).filter(
      (s) => myGroups.includes(s.group_id) && s.weekday === wd,
    );
    if (todays.length > 0) {
      // "session already logged today" — today in the athlete's timezone,
      // translated to real UTC instants (not a UTC-midnight slice).
      const day = localDayUtcBounds(today, tz);
      const { data: session } = await admin
        .from("training_sessions")
        .select("id")
        .eq("athlete_id", a.id)
        .gte("started_at", day.start.toISOString())
        .lt("started_at", day.end.toISOString())
        .limit(1)
        .maybeSingle();
      if (!session) {
        const [h, m] = todays[0].start_time.split(":").map(Number);
        if (minutesNow >= h * 60 + m + 90) {
          const t = text("post_training_reminder", profile.preferred_language);
          const { data: inserted, error } = await admin.from("notifications").upsert(
            {
              profile_id: profile.id,
              kind: "post_training_reminder",
              title: t.title,
              body: t.body,
              dedup_key: `post:${a.id}:${today}`,
            },
            { onConflict: "dedup_key", ignoreDuplicates: true },
          ).select("id");
          if (!error) created += inserted?.length ?? 0;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, notifications_created: created });
}
