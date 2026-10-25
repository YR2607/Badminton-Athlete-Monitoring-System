import { requireRole } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AthleteStatus } from "@/lib/athlete-status";

const COMPONENTS: { label: keyof import("@/i18n").Dictionary["history"]; weight: string; inverted: boolean }[] = [
  { label: "sleep", weight: "20%", inverted: false },
  { label: "recovery", weight: "25%", inverted: false },
  { label: "fatigue", weight: "20%", inverted: true },
  { label: "soreness", weight: "15%", inverted: true },
  { label: "stress", weight: "10%", inverted: true },
  { label: "mood", weight: "10%", inverted: false },
];

const STATUS_ROWS: AthleteStatus[] = ["needs_check", "declining", "no_today", "insufficient", "ok"];

const RULE_CODES = [
  "acute_pain",
  "illness_symptoms",
  "joint_pain",
  "readiness_drop",
  "sustained_decline",
  "repeated_fatigue",
  "missing_morning",
] as const;

export default async function CoachGuidePage() {
  const profile = await requireRole(["coach", "admin"]);
  const dict = getDictionary(profile.preferred_language);
  const g = dict.guide;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight">{g.title}</h1>
        <p className="text-sm text-muted">{g.subtitle}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{g.surveysTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium">
              {dict.morning.title} <span className="text-muted">· {g.surveysDaily}</span>
            </p>
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {[
                dict.morning.sleep,
                dict.morning.recovery,
                dict.morning.fatigue,
                dict.morning.soreness,
                dict.morning.stress,
                dict.morning.mood,
              ].map((q) => (
                <li key={q} className="flex items-start justify-between gap-2">
                  <span>{q}</span>
                  <span className="shrink-0 text-xs">{g.surveysScale}</span>
                </li>
              ))}
              <li className="flex items-start justify-between gap-2">
                <span>{dict.morning.sleepHours}</span>
                <span className="shrink-0 text-xs">{dict.morning.sleepHoursUnit}</span>
              </li>
              <li>{dict.morning.symptomsQuestion}</li>
              <li>{dict.morning.painQuestion}</li>
              <li className="text-xs">{g.surveysPainNote}</li>
            </ul>
          </div>

          <div className="border-t border-border/50 pt-3">
            <p className="text-sm font-medium">
              {dict.postTraining.title} <span className="text-muted">· {g.surveysAfter}</span>
            </p>
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {[
                dict.postTraining.overallFeeling,
                dict.postTraining.legFatigue,
                dict.postTraining.armFatigue,
              ].map((q) => (
                <li key={q} className="flex items-start justify-between gap-2">
                  <span>{q}</span>
                  <span className="shrink-0 text-xs">{g.surveysScale}</span>
                </li>
              ))}
              <li>
                {dict.postTraining.when} ({dict.postTraining.today}/{dict.postTraining.yesterday})
              </li>
              <li className="flex items-start justify-between gap-2">
                <span>{dict.postTraining.rpe}</span>
                <span className="shrink-0 text-xs">0–10</span>
              </li>
              <li className="text-xs">{g.surveysRpeNote}</li>
              <li>{dict.postTraining.minutes}</li>
              <li>{dict.postTraining.painDuring}</li>
            </ul>
          </div>

          <div className="border-t border-border/50 pt-3">
            <p className="text-sm font-medium">
              {dict.ostrc.title} <span className="text-muted">· {g.surveysWeekly}</span>
            </p>
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {[
                dict.ostrc.questions.q1,
                dict.ostrc.questions.q2,
                dict.ostrc.questions.q3,
                dict.ostrc.questions.q4,
              ].map((q) => (
                <li key={q}>{q.replace("{zone}", g.surveysZoneWord)}</li>
              ))}
              <li className="text-xs">{g.surveysOstrcNote}</li>
              <li className="text-xs">{g.surveysOstrcExtra}</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{g.readinessTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">{g.readinessBody}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-1 font-medium">{g.compName}</th>
                <th className="pb-1 font-medium">{g.compWeight}</th>
                <th className="pb-1 font-medium">{g.compDir}</th>
              </tr>
            </thead>
            <tbody>
              {COMPONENTS.map((c) => (
                <tr key={c.label} className="border-t border-border/50">
                  <td className="py-1.5">{dict.history[c.label]}</td>
                  <td className="py-1.5 tabular-nums">{c.weight}</td>
                  <td className="py-1.5 text-muted">
                    {c.inverted ? g.lower : g.higher}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-muted">{g.readinessEvening}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{g.normTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">{g.normBody}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{g.loadTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">{g.loadBody}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{g.statusTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted">{g.statusBody}</p>
          <ul className="space-y-2">
            {STATUS_ROWS.map((s) => (
              <li key={s} className="flex items-start gap-2 text-sm">
                <Badge
                  tone={
                    s === "needs_check"
                      ? "danger"
                      : s === "declining"
                        ? "warn"
                        : s === "ok"
                          ? "ok"
                          : s === "no_today"
                            ? "accent"
                            : "neutral"
                  }
                  className="mt-0.5 shrink-0"
                >
                  {dict.coach.status[s]}
                </Badge>
                <span className="text-muted">{g.statusDesc[s]}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{g.alertsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted">{g.alertsBody}</p>
          <ul className="divide-y divide-border/60 text-sm">
            {RULE_CODES.map((code) => (
              <li key={code} className="py-2">
                <p className="font-medium">{dict.rules.items[code].name}</p>
                <p className="text-muted">{dict.rules.items[code].desc}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{g.dataTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">{g.dataBody}</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted">{g.disclaimer}</p>
    </div>
  );
}
