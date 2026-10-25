import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary, type Dictionary } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckinEditor, PostCheckinEditor } from "./coach-edit";
import {
  conditionScore,
  normalizeCheckin,
  postWellnessScore,
  readinessScore,
} from "@/lib/readiness";
import { cn } from "@/lib/utils";
import type {
  Athlete,
  MorningCheckin,
  PainStatus,
  PostTrainingCheckin,
  Profile,
  TrainingSession,
} from "@/lib/types";

function painLabel(dict: Dictionary, status: PainStatus): string {
  const m = dict.morning;
  return {
    none: m.painNone,
    muscle_soreness: m.painMuscle,
    joint_tendon: m.painJoint,
    acute_instability: m.painAcute,
    other: m.painOther,
  }[status];
}

function sideLabel(dict: Dictionary, side: string | null): string {
  const m = dict.morning;
  return (
    { left: m.sideLeft, right: m.sideRight, both: m.sideBoth, na: m.sideNa }[side ?? "na"] ?? "—"
  );
}

function triggerLabel(dict: Dictionary, t: string): string {
  const m = dict.morning;
  return (
    {
      walking: m.triggerWalking,
      jumping: m.triggerJumping,
      lunges: m.triggerLunges,
      rest: m.triggerRest,
    }[t] ?? t
  );
}

function time(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ScoreRow({ label, value, max = 10 }: { label: string; value: number | null; max?: number }) {
  if (value === null) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="flex gap-0.5">
          {Array.from({ length: max }, (_, i) => (
            <span
              key={i}
              className={
                i < value ? "h-2.5 w-2.5 rounded-full bg-accent" : "h-2.5 w-2.5 rounded-full bg-foreground/10"
              }
            />
          ))}
        </span>
        <span className="w-8 text-right text-sm font-semibold tabular-nums">{value}</span>
      </span>
    </div>
  );
}

function PainBlock({ dict, c }: { dict: Dictionary; c: MorningCheckin | PostTrainingCheckin }) {
  const d = dict.day;
  if (c.pain_status === "none") return null;
  return (
    <div className="mt-3 space-y-1.5 rounded-xl bg-danger/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Badge tone="danger">{d.pain}</Badge>
        <span>{painLabel(dict, c.pain_status)}</span>
      </div>
      {c.pain_location && <p>{c.pain_location}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
        {c.pain_side && c.pain_side !== "na" && <span>{sideLabel(dict, c.pain_side)}</span>}
        {"pain_severity" in c && c.pain_severity !== null && (
          <span>
            {d.severity}: {c.pain_severity}/10
          </span>
        )}
        {"pain_onset" in c && c.pain_onset && (
          <span>
            {d.onset}: {c.pain_onset}
          </span>
        )}
      </div>
      {c.pain_triggers.length > 0 && (
        <p className="text-muted">
          {d.triggers}: {c.pain_triggers.map((t) => triggerLabel(dict, t)).join(", ")}
        </p>
      )}
      <div className="flex gap-3 text-danger">
        {"swelling" in c && c.swelling && <span>{d.swelling}</span>}
        {"movement_limitation" in c && c.movement_limitation && <span>{d.limitation}</span>}
      </div>
    </div>
  );
}

export default async function AthleteDayPage({
  params,
}: {
  params: Promise<{ id: string; date: string }>;
}) {
  const { id, date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const me = (await getCurrentProfile())!;
  const dict = getDictionary(me.preferred_language);
  const d = dict.day;
  const supabase = await createClient();

  const { data: athlete } = await supabase.from("athletes").select("*").eq("id", id).maybeSingle();
  if (!athlete) notFound();
  const a = athlete as Athlete;
  const { data: aProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", a.profile_id)
    .maybeSingle();
  const tz = ((aProfile as Profile | null)?.timezone) ?? me.timezone;

  const [{ data: checkin }, { data: sessions }, { data: postCheckins }, { data: snapshot }] =
    await Promise.all([
    supabase
      .from("morning_checkins")
      .select("*")
      .eq("athlete_id", a.id)
      .eq("checkin_date", date)
      .maybeSingle(),
    supabase
      .from("training_sessions")
      .select("*")
      .eq("athlete_id", a.id)
      .gte("started_at", `${date}T00:00:00Z`)
      .lte("started_at", `${date}T23:59:59Z`)
      .order("started_at"),
    supabase
      .from("post_training_checkins")
      .select("*")
      .eq("athlete_id", a.id)
      .gte("submitted_at", `${date}T00:00:00Z`)
      .lte("submitted_at", `${date}T23:59:59Z`),
    supabase
      .from("readiness_snapshots")
      .select("explanation")
      .eq("athlete_id", a.id)
      .eq("snapshot_date", date)
      .maybeSingle(),
  ]);

  const c = checkin as MorningCheckin | null;
  const posts = (postCheckins as PostTrainingCheckin[]) ?? [];
  const postBySession = new Map(posts.map((p) => [p.training_session_id, p]));
  const latestPost = posts.length
    ? posts.reduce((a, b) => (a.submitted_at >= b.submitted_at ? a : b))
    : null;
  const morningScore = c ? readinessScore(normalizeCheckin(c)) : null;
  const dayScore = c ? conditionScore(c, latestPost) : null;
  const eveningScore = latestPost ? postWellnessScore(latestPost) : null;
  const deltaVsBaseline =
    ((snapshot as { explanation?: { delta_vs_baseline?: number | null } } | null)?.explanation
      ?.delta_vs_baseline ?? null);
  const h = dict.history;

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/coach/athletes/${a.id}`} className="text-sm text-accent">
          ← {d.backToAthlete}
        </Link>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
          {(aProfile as Profile | null)?.display_name ?? a.athlete_code} · {date}
        </h1>
      </div>

      {dayScore !== null && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="text-sm text-muted">{d.dayScore}</p>
              <p className="mt-0.5 text-xs text-muted">
                {d.morningShort} {Math.round(morningScore!)}
                {eveningScore !== null && ` · ${d.eveningShort} ${Math.round(eveningScore)}`}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                title={dict.common.readinessHint}
                className={cn(
                  "score-num text-3xl font-bold leading-none",
                  dayScore >= 70 ? "text-ok" : dayScore >= 45 ? "text-warn" : "text-danger",
                )}
              >
                {Math.round(dayScore)}
              </p>
              {deltaVsBaseline !== null && (
                <p className="mt-1 text-[11px] text-muted">
                  {deltaVsBaseline > 0 ? "▲" : "▼"} {Math.abs(Math.round(deltaVsBaseline))}{" "}
                  {dict.coach.vsBaseline}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{d.morningCheckin}</CardTitle>
        </CardHeader>
        <CardContent>
          {!c ? (
            <p className="text-sm text-muted">{d.noCheckin}</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">
                {d.submittedAt} {time(c.submitted_at, tz)}
              </p>
              <div className="divide-y divide-border/50">
                <ScoreRow label={h.sleep} value={c.sleep_score} />
                {c.sleep_hours != null && (
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-sm text-muted">{dict.morning.sleepHours}</span>
                    <span className="text-sm tabular-nums">{c.sleep_hours} {dict.morning.sleepHoursUnit}</span>
                  </div>
                )}
                <ScoreRow label={h.recovery} value={c.recovery_score} />
                <ScoreRow label={h.fatigue} value={c.fatigue_score} />
                <ScoreRow label={h.soreness} value={c.muscle_soreness_score} />
                <ScoreRow label={h.stress} value={c.stress_score} />
                <ScoreRow label={h.mood} value={c.mood_score} />
              </div>
              <PainBlock dict={dict} c={c} />
              {c.symptoms && (
                <p className="mt-3 rounded-xl bg-warn/10 p-3 text-sm">
                  <b>{d.symptoms}:</b> {c.symptoms}
                </p>
              )}
              {c.notes && (
                <p className="mt-2 text-sm text-muted">
                  <b>{d.notes}:</b> {c.notes}
                </p>
              )}
            </>
          )}
          <CheckinEditor dict={dict} athleteId={a.id} date={date} checkin={c} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{d.sessions}</CardTitle>
        </CardHeader>
        <CardContent>
          {((sessions as TrainingSession[]) ?? []).length === 0 ? (
            <p className="text-sm text-muted">{dict.common.noData}</p>
          ) : (
            <div className="space-y-4">
              {((sessions as TrainingSession[]) ?? []).map((s) => {
                const p = postBySession.get(s.id);
                return (
                  <div key={s.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span>{time(s.started_at, tz)}</span>
                      {s.duration_minutes != null && (
                        <span>
                          {s.duration_minutes} {dict.common.minutes}
                        </span>
                      )}
                      {s.session_rpe != null && (
                        <span>
                          RPE {s.session_rpe}
                        </span>
                      )}
                      {s.session_load != null && (
                        <span className="text-muted">
                          {dict.postTraining.sessionLoad}: {Math.round(s.session_load)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2">
                      <p className="text-xs font-medium text-muted">
                        {d.postCheckin}
                        {!p && ` — ${d.noPost}`}
                      </p>
                      {p && (
                        <>
                          <div className="mt-1 divide-y divide-border/50">
                            <ScoreRow label={dict.postTraining.overallFeeling} value={p.overall_feeling} />
                            <ScoreRow label={dict.postTraining.legFatigue} value={p.leg_fatigue} />
                            <ScoreRow label={dict.postTraining.armFatigue} value={p.arm_shoulder_fatigue} />
                          </div>
                          <PainBlock dict={dict} c={p} />
                          {p.notes && (
                            <p className="mt-2 text-sm text-muted">
                              <b>{d.notes}:</b> {p.notes}
                            </p>
                          )}
                        </>
                      )}
                      <PostCheckinEditor dict={dict} athleteId={a.id} sessionId={s.id} date={date} post={p ?? null} session={s} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {((sessions as TrainingSession[]) ?? []).length === 0 && (
            <PostCheckinEditor dict={dict} athleteId={a.id} sessionId={null} date={date} post={null} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
