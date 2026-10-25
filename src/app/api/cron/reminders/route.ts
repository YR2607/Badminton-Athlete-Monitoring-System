import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate, localMinutesOfDay, localWeekday } from "@/lib/dates";
import { flagEnabled } from "@/lib/flags";
import { sendPushToProfile } from "@/lib/push";
import type { PlanOverride } from "@/lib/load";
import type { Athlete, FeatureFlag, GroupMembership, Profile, TrainingSchedule } from "@/lib/types";

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
  // Overrides are date-keyed; athlete-local "today" spans up to two UTC dates.
  const utcNow = new Date();
  const ovFrom = localDate(new Date(utcNow.getTime() - 86400000), "UTC");
  const ovTo = localDate(new Date(utcNow.getTime() + 86400000), "UTC");
  const [profiles, athletes, memberships, schedules, planOverrides, missingRule, flagsRes] = await Promise.all([
    admin.from("profiles").select("*").eq("role", "athlete"),
    admin.from("athletes").select("*").eq("status", "active"),
    admin.from("group_memberships").select("*").is("left_at", null),
    admin.from("training_schedules").select("*").eq("active", true),
    admin
      .from("session_plan_overrides")
      .select("*")
      .gte("plan_date", ovFrom)
      .lte("plan_date", ovTo),
    admin
      .from("alert_rules")
      .select("severity, params")
      .eq("code", "missing_morning")
      .eq("enabled", true)
      .maybeSingle(),
    admin.from("feature_flags").select("key, enabled, group_ids"),
  ]);
  const readError = profiles.error ?? athletes.error ?? memberships.error ?? schedules.error;
  if (readError) {
    return NextResponse.json({ error: "db_read_failed" }, { status: 500 });
  }

  // Batch fetch "today's" data once — athlete-local today can be UTC-1..+1.
  const athleteRows = (athletes.data as Athlete[] | null) ?? [];
  const athleteIds = athleteRows.map((a) => a.id);
  const [{ data: todayCheckins }, { data: todaySessions }] = athleteIds.length
    ? await Promise.all([
        admin
          .from("morning_checkins")
          .select("athlete_id, checkin_date")
          .in("athlete_id", athleteIds)
          .gte("checkin_date", ovFrom)
          .lte("checkin_date", ovTo),
        admin
          .from("training_sessions")
          .select("athlete_id, started_at")
          .in("athlete_id", athleteIds)
          .gte("started_at", `${ovFrom}T00:00:00Z`)
          .lte("started_at", `${ovTo}T23:59:59Z`),
      ])
    : [{ data: [] }, { data: [] }];
  const ckSet = new Set(
    ((todayCheckins as { athlete_id: string; checkin_date: string }[] | null) ?? []).map(
      (c) => `${c.athlete_id}|${c.checkin_date}`,
    ),
  );
  const sessionsByAthlete = new Map<string, string[]>();
  for (const s of (todaySessions as { athlete_id: string; started_at: string }[] | null) ?? []) {
    const list = sessionsByAthlete.get(s.athlete_id) ?? [];
    list.push(s.started_at);
    sessionsByAthlete.set(s.athlete_id, list);
  }

  const profById = new Map(((profiles.data as Profile[] | null) ?? []).map((p) => [p.id, p]));
  const flags = (flagsRes.data as FeatureFlag[] | null) ?? [];
  const memberGroups = (athleteId: string) =>
    ((memberships.data as GroupMembership[] | null) ?? [])
      .filter((m) => m.athlete_id === athleteId)
      .map((m) => m.group_id);
  const pushFor = (athleteId: string) => flagEnabled(flags, "push", memberGroups(athleteId));
  let pushed = 0;
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

    const ck = ckSet.has(`${a.id}|${today}`);

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
      if (!error && inserted?.length) {
        created += inserted.length;
        if (pushFor(a.id)) {
          pushed += await sendPushToProfile(admin, profile.id, { title: t.title, body: t.body, url: "/athlete" });
        }
      }
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
    // Per-date overrides REPLACE the template for that date: a cancelled one
    // removes the day's sessions, an active one provides its own start_time
    // (falling back to the weekday's template start, then 19:00).
    const myOv = ((planOverrides.data as PlanOverride[] | null) ?? []).filter(
      (o) => myGroups.includes((o as { group_id?: string }).group_id!) && o.plan_date === today,
    ) as (PlanOverride & { group_id: string })[];
    const overriddenGroups = new Set(myOv.map((o) => o.group_id));
    const allSchedules = (schedules.data as TrainingSchedule[] | null) ?? [];
    const todays = allSchedules.filter(
      (s) => myGroups.includes(s.group_id) && s.weekday === wd && !overriddenGroups.has(s.group_id),
    );
    const startTimes = [
      ...todays.map((s) => s.start_time),
      ...myOv
        .filter((o) => !o.cancelled)
        .map(
          (o) =>
            o.start_time ??
            allSchedules.find((s) => s.group_id === o.group_id && s.weekday === wd)?.start_time ??
            "19:00",
        ),
    ];
    if (startTimes.length > 0) {
      // "session already logged today" — judged in the athlete's timezone.
      const hasSessionToday = (sessionsByAthlete.get(a.id) ?? []).some(
        (st) => localDate(new Date(st), tz) === today,
      );
      if (!hasSessionToday) {
        const earliest = startTimes.slice().sort()[0];
        const [h, m] = earliest.split(":").map(Number);
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
          if (!error && inserted?.length) {
            created += inserted.length;
            if (pushFor(a.id)) {
              pushed += await sendPushToProfile(admin, profile.id, {
                title: t.title,
                body: t.body,
                url: "/athlete/training",
              });
            }
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true, notifications_created: created, pushes_sent: pushed });
}
