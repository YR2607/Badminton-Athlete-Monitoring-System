import type { Dictionary } from "@/i18n";
import type { FieldTest, FieldTestResult, MorningCheckin } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Lang = "ru" | "en" | "ro";

export function AthleteHabitBadges({
  dict,
  streak,
  recentCheckins,
  sessions7Count,
}: {
  dict: Dictionary;
  streak: number;
  recentCheckins: MorningCheckin[];
  sessions7Count: number;
}) {
  const p = dict.pro;
  const goodSleepNights = recentCheckins
    .slice(0, 7)
    .filter((c) => (c.sleep_hours ?? 0) >= 8 || c.sleep_score >= 8).length;
  const honestSignal = recentCheckins.some(
    (c) => c.pain_status !== "none" || Boolean(c.notes?.trim()),
  );

  const badges = [
    {
      key: "s7",
      title: p.badgeStreak7,
      desc: p.badgeStreak7Desc,
      unlocked: streak >= 7,
      progress: `${Math.min(7, streak)}/7`,
    },
    {
      key: "s21",
      title: p.badgeStreak21,
      desc: p.badgeStreak21Desc,
      unlocked: streak >= 21,
      progress: `${Math.min(21, streak)}/21`,
    },
    {
      key: "sleep",
      title: p.badgeSleepMaster,
      desc: p.badgeSleepMasterDesc,
      unlocked: goodSleepNights >= 5,
      progress: `${Math.min(5, goodSleepNights)}/5`,
    },
    {
      key: "work",
      title: p.badgeWorkhorse,
      desc: p.badgeWorkhorseDesc,
      unlocked: sessions7Count >= 4,
      progress: `${Math.min(4, sessions7Count)}/4`,
    },
    {
      key: "honest",
      title: p.badgeHonestSignal,
      desc: p.badgeHonestSignalDesc,
      unlocked: honestSignal,
      progress: honestSignal ? "✓" : "0/1",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{p.badgesTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((b) => (
            <div
              key={b.key}
              className={cn(
                "flex items-start justify-between gap-2 rounded-xl border p-2.5 text-xs transition-colors",
                b.unlocked
                  ? "border-ok/40 bg-ok/10 text-foreground"
                  : "border-border/60 bg-foreground/[0.02] text-muted opacity-75",
              )}
            >
              <div className="min-w-0">
                <p className="font-semibold">{b.title}</p>
                <p className="mt-0.5 text-[11px] text-muted">{b.desc}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
                  b.unlocked ? "bg-ok text-white" : "bg-foreground/10 text-muted",
                )}
              >
                {b.unlocked ? "✓" : b.progress}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Spider / radar chart over active field tests (FIFA-card style for teens).
 * Needs ≥ 3 tests with at least one result for the athlete; otherwise hidden.
 */
export function FieldTestRadar({
  dict,
  lang,
  tests,
  ownResults,
  groupMedian,
}: {
  dict: Dictionary;
  lang: string;
  tests: FieldTest[];
  ownResults: FieldTestResult[];
  groupMedian: Record<string, number | null>;
}) {
  const p = dict.pro;

  // Pick up to 6 tests where the athlete has at least one result.
  const axes = tests
    .map((t) => {
      const vals = ownResults.filter((r) => r.test_id === t.id).map((r) => Number(r.value));
      if (vals.length === 0) return null;
      const best = t.higher_better ? Math.max(...vals) : Math.min(...vals);
      const med = groupMedian[t.id] ?? best;
      // Score 0..100 relative to the reference (max of best, median * 1.25).
      const ratio = t.higher_better
        ? med > 0
          ? best / (med * 1.2)
          : 0.8
        : best > 0
          ? (med * 0.85) / best
          : 0.8;
      const ownPct = Math.min(100, Math.max(30, Math.round(ratio * 100)));
      const medPct = 78; // group median sits on the ~78% reference ring
      return {
        id: t.id,
        label: t.name[lang as Lang] || t.name.en || t.code,
        unit: t.unit,
        best,
        ownPct,
        medPct,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 6);

  if (axes.length < 3) return null;

  const cx = 130;
  const cy = 120;
  const radius = 78;
  const n = axes.length;

  const pt = (i: number, pct: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = (pct / 100) * radius;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  };

  const poly = (pcts: number[]) =>
    pcts
      .map((pct, i) => {
        const [x, y] = pt(i, pct);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{p.radarTitle}</CardTitle>
        <p className="text-xs text-muted">{p.radarHint}</p>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3 sm:flex-row">
        <svg viewBox="0 0 260 240" className="h-56 w-64 shrink-0 select-none">
          {[0.35, 0.65, 1].map((ring) => (
            <polygon
              key={ring}
              points={poly(Array(n).fill(ring * 100))}
              fill="none"
              stroke="var(--border)"
              strokeDasharray={ring < 1 ? "3 3" : undefined}
            />
          ))}
          {axes.map((_, i) => {
            const [x, y] = pt(i, 100);
            return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" />;
          })}
          {/* Group median polygon */}
          <polygon
            points={poly(axes.map((a) => a.medPct))}
            fill="none"
            stroke="var(--chart-muted)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          {/* Athlete polygon */}
          <polygon
            points={poly(axes.map((a) => a.ownPct))}
            fill="var(--accent)"
            fillOpacity={0.22}
            stroke="var(--accent)"
            strokeWidth="2"
          />
          {axes.map((a, i) => {
            const [vx, vy] = pt(i, a.ownPct);
            const [lx, ly] = pt(i, 118);
            return (
              <g key={a.id}>
                <circle cx={vx} cy={vy} r={3.5} fill="var(--accent)" />
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-foreground text-[9px] font-medium"
                >
                  {a.label.slice(0, 14)}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="flex-1 space-y-1.5 text-xs">
          {axes.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-2.5 py-1.5"
            >
              <span className="truncate font-medium">{a.label}</span>
              <span className="shrink-0 font-bold tabular-nums text-accent">
                {a.best} {a.unit}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
