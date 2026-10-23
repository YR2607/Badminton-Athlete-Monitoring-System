import type {
  AlertRule,
  AlertSeverity,
  MorningCheckin,
  PostTrainingCheckin,
} from "@/lib/types";
import type { Baseline } from "@/lib/readiness";
import { addDays, localDate } from "@/lib/dates";

/**
 * Rule-based alert engine. Every alert carries concrete evidence so a coach can
 * see exactly which data triggered it. Alerts are signals for review — never
 * medical diagnoses or injury predictions.
 *
 * Severity mapping: normal < attention < review_load < priority.
 * Pain/medical signals are evaluated independently of the readiness score:
 * a high score can never cancel a priority alert.
 */

export interface EvalContext {
  athleteId: string;
  today: string; // athlete-local date YYYY-MM-DD
  timezone?: string; // athlete TZ — used to assign submitted_at to a local day
  checkin: MorningCheckin | null; // today's morning check-in, if any
  recentCheckins: MorningCheckin[]; // recent days incl. today, any order
  dailyReadiness: { date: string; score: number }[]; // ascending by date
  baseline: Baseline | null;
  postCheckins: PostTrainingCheckin[]; // recent ~14d
  rules: AlertRule[]; // enabled rules
}

export interface AlertCandidate {
  rule_code: string;
  severity: AlertSeverity;
  evidence: Record<string, unknown>;
  recommendation: string;
  dedup_key: string;
  source_checkin_id: string | null;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  normal: 0,
  attention: 1,
  review_load: 2,
  priority: 3,
};

const RECO: Record<string, string> = {
  acute_pain:
    "Острая боль / отёк / ограничение движения / нестабильность. Не выполнять провоцирующие упражнения, сообщить ответственному взрослому, при необходимости — медицинская оценка.",
  illness_symptoms:
    "Спортсмен сообщил о симптомах, влияющих на тренировку. Уточнить состояние до занятия; при выраженных симптомах — медицинская оценка.",
  joint_pain:
    "Боль в суставе/сухожилии. Поговорить со спортсменом, исключить провоцирующие движения, повторно оценить на следующий день.",
  readiness_drop:
    "Готовность ниже личной нормы. Обсудить восстановление (сон, нагрузка, стресс) и при необходимости скорректировать интенсивность.",
  sustained_decline:
    "Состояние хуже личной нормы несколько дней подряд. Пересмотреть ближайшую нагрузку и обсудить восстановление.",
  repeated_fatigue:
    "Высокая субъективная усталость несколько дней подряд. Проверить сон и восстановление, рассмотреть лёгкий день.",
};

function rule(ctx: EvalContext, code: string): AlertRule | undefined {
  return ctx.rules.find((r) => r.code === code && r.enabled);
}

function num(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

function mk(
  ctx: EvalContext,
  code: string,
  severity: AlertSeverity,
  evidence: Record<string, unknown>,
  sourceCheckinId: string | null,
): AlertCandidate {
  return {
    rule_code: code,
    severity,
    evidence,
    recommendation: RECO[code] ?? "Проверить состояние спортсмена.",
    dedup_key: `${ctx.athleteId}:${code}:${ctx.today}`,
    source_checkin_id: sourceCheckinId,
  };
}

interface PainSignal {
  status: string;
  severity: number | null;
  swelling: boolean;
  limitation: boolean;
  location: string | null;
  triggers: string[];
  source: "morning" | "post_training";
  sourceId: string;
}

function painSignals(ctx: EvalContext): PainSignal[] {
  const out: PainSignal[] = [];
  for (const c of ctx.recentCheckins) {
    if (c.pain_status !== "none") {
      out.push({
        status: c.pain_status,
        severity: c.pain_severity,
        swelling: c.swelling === true,
        limitation: c.movement_limitation === true,
        location: c.pain_location,
        triggers: c.pain_triggers ?? [],
        source: "morning",
        sourceId: c.id,
      });
    }
  }
  for (const p of ctx.postCheckins) {
    if (p.pain_status !== "none") {
      out.push({
        status: p.pain_status,
        severity: null,
        swelling: false,
        limitation: false,
        location: p.pain_location,
        triggers: p.pain_triggers ?? [],
        source: "post_training",
        sourceId: p.id,
      });
    }
  }
  return out;
}

export function evaluateAlerts(ctx: EvalContext): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const pain = painSignals(ctx);
  // Single authoritative rule: every timestamp is assigned to a calendar day
  // in the athlete's timezone. Fallback without a timezone is explicit UTC.
  const tz = ctx.timezone ?? "UTC";
  const todayPain = pain.filter((p) => {
    // only signals reported today trigger new alerts
    if (p.source === "morning") {
      const c = ctx.recentCheckins.find((x) => x.id === p.sourceId);
      return c?.checkin_date === ctx.today;
    }
    const pc = ctx.postCheckins.find((x) => x.id === p.sourceId);
    if (!pc) return false;
    return localDate(new Date(pc.submitted_at), tz) === ctx.today;
  });

  // ---- priority: acute pain / red flags (independent of readiness score) ----
  const acuteRule = rule(ctx, "acute_pain");
  if (acuteRule) {
    const statuses = (acuteRule.params.pain_statuses as string[] | undefined) ?? [
      "acute_instability",
    ];
    const minSeverity = num(acuteRule.params.min_severity, 7);
    for (const p of todayPain) {
      const acute =
        statuses.includes(p.status) ||
        p.swelling ||
        p.limitation ||
        (p.severity !== null && p.severity >= minSeverity);
      if (acute) {
        out.push(
          mk(ctx, "acute_pain", "priority", {
            pain_status: p.status,
            pain_location: p.location,
            pain_severity: p.severity,
            swelling: p.swelling,
            movement_limitation: p.limitation,
            triggers: p.triggers,
            source: p.source,
          }, p.sourceId),
        );
        break;
      }
    }
  }

  // ---- priority: illness symptoms reported today ----
  const illnessRule = rule(ctx, "illness_symptoms");
  if (illnessRule && ctx.checkin?.symptoms?.trim()) {
    out.push(
      mk(ctx, "illness_symptoms", "priority", {
        symptoms: ctx.checkin.symptoms,
        checkin_date: ctx.checkin.checkin_date,
      }, ctx.checkin.id),
    );
  }

  // ---- joint/tendon pain (non-acute) ----
  const jointRule = rule(ctx, "joint_pain");
  if (jointRule) {
    const minSeverity = num(jointRule.params.min_severity, 5);
    for (const p of todayPain) {
      if (p.status === "joint_tendon" || p.status === "other") {
        const severe = p.severity !== null && p.severity >= minSeverity;
        out.push(
          mk(
            ctx,
            "joint_pain",
            severe ? "review_load" : "attention",
            {
              pain_status: p.status,
              pain_location: p.location,
              pain_severity: p.severity,
              source: p.source,
            },
            p.sourceId,
          ),
        );
        break;
      }
    }
  }

  // ---- readiness-based rules need a sufficient baseline ----
  const todayScore = ctx.dailyReadiness.find((d) => d.date === ctx.today)?.score ?? null;

  const dropRule = rule(ctx, "readiness_drop");
  if (dropRule && ctx.baseline && todayScore !== null) {
    const sdBelow = num(dropRule.params.sd_below, 1.0);
    const minAbs = num(dropRule.params.min_abs_drop, 10);
    const drop = ctx.baseline.avg - todayScore;
    // sd==0 means a perfectly stable baseline — any drop is notable, so we
    // also apply the absolute threshold.
    if ((ctx.baseline.sd > 0 && drop > sdBelow * ctx.baseline.sd) || drop >= minAbs) {
      out.push(
        mk(ctx, "readiness_drop", "attention", {
          today_score: todayScore,
          baseline_avg: ctx.baseline.avg,
          baseline_sd: ctx.baseline.sd,
          delta: -drop,
        }, ctx.checkin?.id ?? null),
      );
    }
  }

  const sustainedRule = rule(ctx, "sustained_decline");
  if (sustainedRule && ctx.baseline) {
    const days = num(sustainedRule.params.days, 3);
    const window = dateWindow(ctx.today, days);
    const scores = ctx.dailyReadiness.filter((d) => window.includes(d.date));
    if (scores.length >= days && scores.every((s) => s.score < ctx.baseline!.avg)) {
      out.push(
        mk(ctx, "sustained_decline", "review_load", {
          days_below_baseline: scores.length,
          baseline_avg: ctx.baseline.avg,
          recent_scores: scores,
        }, ctx.checkin?.id ?? null),
      );
    }
  }

  // ---- repeated high fatigue ----
  const fatigueRule = rule(ctx, "repeated_fatigue");
  if (fatigueRule) {
    const days = num(fatigueRule.params.days, 3);
    const min = num(fatigueRule.params.fatigue_min, 4);
    const window = dateWindow(ctx.today, days);
    const fatigues = ctx.recentCheckins.filter((c) => window.includes(c.checkin_date));
    if (fatigues.length >= days && fatigues.every((c) => c.fatigue_score >= min)) {
      out.push(
        mk(ctx, "repeated_fatigue", "attention", {
          days: fatigues.length,
          fatigue_scores: fatigues.map((f) => ({
            date: f.checkin_date,
            fatigue: f.fatigue_score,
          })),
        }, ctx.checkin?.id ?? null),
      );
    }
  }

  // keep only the strongest candidate per rule
  const best = new Map<string, AlertCandidate>();
  for (const a of out) {
    const cur = best.get(a.rule_code);
    if (!cur || SEVERITY_RANK[a.severity] > SEVERITY_RANK[cur.severity]) {
      best.set(a.rule_code, a);
    }
  }
  return [...best.values()];
}

function dateWindow(today: string, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

/** Athlete-facing recovery recommendation band (from readiness score). */
export function bandAdviceKey(score: number | null): "good" | "moderate" | "low" | "nodata" {
  if (score === null) return "nodata";
  if (score >= 70) return "good";
  if (score >= 45) return "moderate";
  return "low";
}
