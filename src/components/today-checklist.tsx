import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Circle,
  GraduationCap,
  HeartPulse,
  Sunrise,
  Sunset,
} from "lucide-react";
import type { Dictionary } from "@/i18n";
import type { TodaySurveyStatus } from "@/lib/types";

export type SurveyRowKey = "morning" | "post" | "ostrc" | "academy";

export interface SurveyRow {
  key: SurveyRowKey;
  done: boolean;
  label: string;
  hint: string;
  hintTone: "ok" | "warn";
  href: string;
  /** Pending but not expected right now (no training scheduled) — softer CTA. */
  soft?: boolean;
}

type Dict = Dictionary["athleteHome"];

/** Pure row builder — every questionnaire the athlete can see today. */
export function buildSurveyRows(
  d: Dict,
  s: TodaySurveyStatus,
  exclude?: SurveyRowKey,
): SurveyRow[] {
  const rows: SurveyRow[] = [
    {
      key: "morning",
      done: s.morningDone,
      label: d.morningLabel,
      hint: s.morningDone ? d.filled : d.notFilled,
      hintTone: s.morningDone ? "ok" : "warn",
      href: "/athlete/morning",
    },
    {
      key: "post",
      done: s.postDone,
      label: d.postLabel,
      hint: s.postDone
        ? d.filled
        : s.scheduledToday
          ? d.notFilled
          : d.noTrainingScheduled,
      hintTone: s.postDone ? "ok" : "warn",
      href: "/athlete/training",
      soft: !s.postDone && !s.scheduledToday,
    },
  ];
  if (s.ostrcEnabled) {
    rows.push({
      key: "ostrc",
      done: s.ostrcDone,
      label: d.ostrcLabel,
      hint: s.ostrcDone ? d.filled : d.notFilled,
      hintTone: s.ostrcDone ? "ok" : "warn",
      href: "/athlete/ostrc",
    });
  }
  if (s.academyOn && s.academyTotal > 0) {
    const done = s.academyDone >= s.academyTotal;
    rows.push({
      key: "academy",
      done,
      label: d.academyLabel,
      hint: done
        ? d.completed
        : d.progressOf
            .replace("{done}", String(s.academyDone))
            .replace("{total}", String(s.academyTotal)),
      hintTone: done ? "ok" : "warn",
      href: "/athlete/academy",
    });
  }
  return exclude ? rows.filter((r) => r.key !== exclude) : rows;
}

const ICONS: Record<SurveyRowKey, ReactNode> = {
  morning: <Sunrise size={20} />,
  post: <Sunset size={20} />,
  ostrc: <HeartPulse size={20} />,
  academy: <GraduationCap size={20} />,
};

/**
 * Unified "what to fill in today" checklist — every pending questionnaire is
 * visible in one place: on the athlete home and inside the health check-in
 * pages themselves. `exclude` hides the row for the page it is rendered on.
 */
export function TodayChecklist({
  d,
  status,
  exclude,
}: {
  d: Dict;
  status: TodaySurveyStatus;
  exclude?: SurveyRowKey;
}) {
  const rows = buildSurveyRows(d, status, exclude);
  const doneCount = rows.filter((r) => r.done).length;
  const allDone = rows.length > 0 && doneCount === rows.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-2 text-base">
          <span className="min-w-0">{d.surveysTitle}</span>
          <span className="shrink-0 whitespace-nowrap text-xs font-normal text-muted">
            {d.progressOf
              .replace("{done}", String(doneCount))
              .replace("{total}", String(rows.length))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) =>
          row.done ? (
            <div
              key={row.key}
              className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/5 p-3"
            >
              <CheckCircle2 className="shrink-0 text-ok" size={22} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="text-muted">{ICONS[row.key]}</span>
                  {row.label}
                </p>
                <p className="text-xs text-ok">{row.hint}</p>
              </div>
            </div>
          ) : (
            <div
              key={row.key}
              className="flex items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn/5 p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Circle className="shrink-0 text-warn" size={22} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="text-muted">{ICONS[row.key]}</span>
                    {row.label}
                  </p>
                  <p className="text-xs text-warn">{row.hint}</p>
                </div>
              </div>
              <Link href={row.href} className="shrink-0">
                <Button size="sm" variant={row.soft ? "secondary" : "default"}>
                  {d.fillBtn}
                </Button>
              </Link>
            </div>
          ),
        )}
        {allDone && (
          <p className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/5 p-3 text-sm text-ok">
            <CheckCircle2 className="shrink-0" size={20} />
            {d.allDone}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
