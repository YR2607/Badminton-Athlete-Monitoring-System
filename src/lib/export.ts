import type ExcelJS from "exceljs";
import type {
  Alert,
  Athlete,
  FieldTest,
  FieldTestResult,
  GrowthMeasurement,
  MorningCheckin,
  PostTrainingCheckin,
  ReadinessSnapshot,
  Recommendation,
  TrainingSchedule,
  TrainingSession,
} from "@/lib/types";
import { localDate } from "@/lib/dates";
import { normalizeCheckin, readinessScore } from "@/lib/readiness";
import { acwrSeries, dailyLoads, monotony, strain, type PlanOverride } from "@/lib/load";

export interface ExportBundle {
  generatedAt: string;
  timezone: string;
  rangeFrom: string;
  rangeTo: string;
  athletes: (Athlete & { display_name?: string; group_name?: string })[];
  morning: MorningCheckin[];
  sessions: TrainingSession[];
  postCheckins: PostTrainingCheckin[];
  snapshots: ReadinessSnapshot[];
  alerts: Alert[];
  notes: { athlete_id: string; created_at: string; kind: string; note: string }[];
  /** Phase 10 extras (optional — older callers may omit them). */
  schedules?: TrainingSchedule[];
  planOverrides?: (PlanOverride & { group_id: string })[];
  athleteGroups?: { athlete_id: string; group_id: string }[];
  growth?: GrowthMeasurement[];
  testResults?: FieldTestResult[];
  testsDict?: FieldTest[];
  recommendations?: Recommendation[];
}

const esc = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  // CSV formula injection: a leading = + - @ or tab executes in Excel/Sheets.
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

function athleteLabel(b: ExportBundle, id: string): string {
  const a = b.athletes.find((x) => x.id === id);
  return a?.athlete_code ?? id;
}

interface LoadRow {
  athlete_id: string;
  date: string;
  load: number;
  planned: number | null;
  acwr: number | null;
  monotony: number | null;
  strain: number | null;
}

/** Per-athlete daily sRPE load + EWMA-ACWR + Foster monotony/strain. */
function loadRows(b: ExportBundle): LoadRow[] {
  const groupOf = new Map((b.athleteGroups ?? []).map((m) => [m.athlete_id, m.group_id]));
  const schedByGroup = new Map<string, TrainingSchedule[]>();
  for (const s of b.schedules ?? []) {
    const list = schedByGroup.get(s.group_id) ?? [];
    list.push(s);
    schedByGroup.set(s.group_id, list);
  }
  const ovByGroup = new Map<string, PlanOverride[]>();
  for (const o of b.planOverrides ?? []) {
    const list = ovByGroup.get(o.group_id) ?? [];
    list.push(o);
    ovByGroup.set(o.group_id, list);
  }
  const dates: string[] = [];
  for (let d = b.rangeFrom; d <= b.rangeTo; ) {
    dates.push(d);
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  const out: LoadRow[] = [];
  for (const a of b.athletes) {
    const gid = groupOf.get(a.id) ?? "";
    const sched = (schedByGroup.get(gid) ?? []).map((s) => ({
      weekday: s.weekday,
      planned_minutes: s.planned_minutes,
      planned_rpe: s.planned_rpe,
    }));
    const overrides = ovByGroup.get(gid) ?? [];
    const inputs = b.sessions
      .filter((s) => s.athlete_id === a.id)
      .map((s) => ({
        date: localDate(new Date(s.started_at), b.timezone),
        rpe: s.session_rpe,
        minutes: s.duration_minutes,
      }));
    const days = dailyLoads(dates, inputs, sched, overrides);
    const acwr = acwrSeries(days.map((d) => d.load));
    days.forEach((day, i) => {
      const week = days.slice(Math.max(0, i - 6), i + 1).map((d) => d.load);
      out.push({
        athlete_id: a.id,
        date: day.date,
        load: day.load,
        planned: day.planned,
        acwr: acwr[i] !== null ? Math.round(acwr[i]! * 100) / 100 : null,
        monotony: monotony(week) !== null ? Math.round(monotony(week)! * 100) / 100 : null,
        strain: strain(week) !== null ? Math.round(strain(week)!) : null,
      });
    });
  }
  return out;
}

export function buildCsv(b: ExportBundle): string {
  const parts: string[] = [];
  parts.push(`# RallyMonitor export · ${b.generatedAt} · TZ ${b.timezone} · ${b.rangeFrom}..${b.rangeTo}`);
  parts.push("");
  parts.push("## Athletes");
  parts.push(toCsv(["athlete_code", "group", "birth_year", "status"], b.athletes.map((a) => [a.athlete_code, a.group_name ?? "", a.birth_year ?? "", a.status])));
  parts.push("");
  parts.push("## Morning Check-ins");
  parts.push(
    toCsv(
      ["athlete_code", "checkin_date", "submitted_at", "sleep", "sleep_hours", "recovery", "fatigue", "soreness", "stress", "mood", "readiness", "pain_status", "pain_location", "pain_side", "pain_severity", "swelling", "limitation", "symptoms", "notes"],
      b.morning.map((c) => [
        athleteLabel(b, c.athlete_id), c.checkin_date, c.submitted_at,
        c.sleep_score, c.sleep_hours ?? "", c.recovery_score, c.fatigue_score, c.muscle_soreness_score,
        c.stress_score, c.mood_score, readinessScore(normalizeCheckin(c)),
        c.pain_status, c.pain_location ?? "", c.pain_side ?? "", c.pain_severity ?? "",
        c.swelling ?? "", c.movement_limitation ?? "", c.symptoms ?? "", c.notes ?? "",
      ]),
    ),
  );
  parts.push("");
  parts.push("## Training Sessions");
  parts.push(
    toCsv(
      ["athlete_code", "started_at", "date", "session_rpe", "duration_minutes", "session_load"],
      b.sessions.map((s) => [
        athleteLabel(b, s.athlete_id), s.started_at, localDate(new Date(s.started_at), b.timezone),
        s.session_rpe ?? "", s.duration_minutes ?? "", s.session_load ?? "",
      ]),
    ),
  );
  parts.push("");
  parts.push("## Daily Scores (snapshots)");
  parts.push(
    toCsv(
      ["athlete_code", "date", "readiness", "z_score", "norm_avg", "norm_sd", "confidence"],
      b.snapshots.map((s) => [
        athleteLabel(b, s.athlete_id), s.snapshot_date, s.readiness_score,
        s.z_score ?? "", s.score_norm?.avg ?? "", s.score_norm?.sd ?? "", s.confidence,
      ]),
    ),
  );
  parts.push("");
  parts.push("## Daily Load (sRPE)");
  parts.push(
    toCsv(
      ["athlete_code", "date", "load_au", "planned_au", "acwr", "monotony_7d", "strain_7d"],
      loadRows(b).map((r) => [
        athleteLabel(b, r.athlete_id), r.date, r.load, r.planned ?? "",
        r.acwr ?? "", r.monotony ?? "", r.strain ?? "",
      ]),
    ),
  );
  if (b.growth?.length) {
    parts.push("");
    parts.push("## Growth Measurements");
    parts.push(
      toCsv(
        ["athlete_code", "measured_on", "height_cm", "weight_kg", "sitting_height_cm"],
        b.growth.map((g) => [
          athleteLabel(b, g.athlete_id), g.measured_on, g.height_cm,
          g.weight_kg ?? "", g.sitting_height_cm ?? "",
        ]),
      ),
    );
  }
  if (b.testResults?.length) {
    const testName = (id: string) => b.testsDict?.find((t) => t.id === id)?.code ?? id;
    parts.push("");
    parts.push("## Field Tests");
    parts.push(
      toCsv(
        ["athlete_code", "test", "test_date", "value", "attempt"],
        b.testResults.map((r) => [
          athleteLabel(b, r.athlete_id), testName(r.test_id), r.test_date, r.value, r.attempt,
        ]),
      ),
    );
  }
  if (b.recommendations?.length) {
    parts.push("");
    parts.push("## Recommendations");
    parts.push(
      toCsv(
        ["athlete_code", "rec_date", "rule", "severity", "decision", "coach_comment"],
        b.recommendations.map((r) => [
          athleteLabel(b, r.athlete_id), r.rec_date, r.rule_key, r.severity,
          r.decision, r.coach_comment ?? "",
        ]),
      ),
    );
  }
  parts.push("");
  parts.push("## Post-Training Check-ins");
  parts.push(
    toCsv(
      ["athlete_code", "session_id", "submitted_at", "overall", "legs", "arms", "pain_status", "pain_location", "notes"],
      b.postCheckins.map((p) => [
        athleteLabel(b, p.athlete_id), p.training_session_id, p.submitted_at,
        p.overall_feeling, p.leg_fatigue, p.arm_shoulder_fatigue,
        p.pain_status, p.pain_location ?? "", p.notes ?? "",
      ]),
    ),
  );
  parts.push("");
  parts.push("## Alerts");
  parts.push(
    toCsv(
      ["athlete_code", "rule", "severity", "status", "triggered_at", "recommendation", "resolution_note"],
      b.alerts.map((a) => [
        athleteLabel(b, a.athlete_id), a.rule_code, a.severity, a.status, a.triggered_at,
        a.recommendation, a.resolution_note ?? "",
      ]),
    ),
  );
  return parts.join("\n");
}

export async function buildXlsx(b: ExportBundle): Promise<Buffer> {
  // ~900KB — loaded only when an XLSX export is actually requested.
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, headers: string[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers);
    // Strings that look like formulas are prefixed so a hostile note cannot
    // execute when the file is opened in Excel.
    for (const r of rows) {
      ws.addRow(
        r.map((v) =>
          typeof v === "string" && /^[=+\-@\t]/.test(v) ? `'${v}` : (v as ExcelJS.CellValue),
        ),
      );
    }
  };

  sheet("Summary", ["field", "value"], [
    ["generated_at", b.generatedAt],
    ["timezone", b.timezone],
    ["range_from", b.rangeFrom],
    ["range_to", b.rangeTo],
    ["athletes", b.athletes.length],
    ["morning_checkins", b.morning.length],
    ["sessions", b.sessions.length],
    ["post_checkins", b.postCheckins.length],
    ["alerts", b.alerts.length],
  ]);
  sheet("Athletes", ["athlete_code", "display_name", "group", "birth_year", "status"],
    b.athletes.map((a) => [a.athlete_code, a.display_name ?? "", a.group_name ?? "", a.birth_year ?? "", a.status]));
  sheet("Morning Check-ins",
    ["athlete_code", "checkin_date", "submitted_at", "sleep", "sleep_hours", "recovery", "fatigue", "soreness", "stress", "mood", "readiness", "pain_status", "pain_location", "pain_side", "pain_severity", "swelling", "limitation", "symptoms", "notes"],
    b.morning.map((c) => [
      athleteLabel(b, c.athlete_id), c.checkin_date, c.submitted_at,
      c.sleep_score, c.sleep_hours ?? "", c.recovery_score, c.fatigue_score, c.muscle_soreness_score,
      c.stress_score, c.mood_score, readinessScore(normalizeCheckin(c)),
      c.pain_status, c.pain_location ?? "", c.pain_side ?? "", c.pain_severity ?? "",
      c.swelling ?? "", c.movement_limitation ?? "", c.symptoms ?? "", c.notes ?? "",
    ]));
  sheet("Training Sessions",
    ["athlete_code", "started_at", "date", "session_rpe", "duration_minutes", "session_load"],
    b.sessions.map((s) => [
      athleteLabel(b, s.athlete_id), s.started_at, localDate(new Date(s.started_at), b.timezone),
      s.session_rpe ?? "", s.duration_minutes ?? "", s.session_load ?? "",
    ]));
  sheet("Daily Scores",
    ["athlete_code", "date", "readiness", "z_score", "norm_avg", "norm_sd", "confidence"],
    b.snapshots.map((s) => [
      athleteLabel(b, s.athlete_id), s.snapshot_date, s.readiness_score,
      s.z_score ?? "", s.score_norm?.avg ?? "", s.score_norm?.sd ?? "", s.confidence,
    ]));
  sheet("Daily Load",
    ["athlete_code", "date", "load_au", "planned_au", "acwr", "monotony_7d", "strain_7d"],
    loadRows(b).map((r) => [
      athleteLabel(b, r.athlete_id), r.date, r.load, r.planned ?? "",
      r.acwr ?? "", r.monotony ?? "", r.strain ?? "",
    ]));
  if (b.growth?.length) {
    sheet("Growth",
      ["athlete_code", "measured_on", "height_cm", "weight_kg", "sitting_height_cm"],
      b.growth.map((g) => [
        athleteLabel(b, g.athlete_id), g.measured_on, g.height_cm,
        g.weight_kg ?? "", g.sitting_height_cm ?? "",
      ]));
  }
  if (b.testResults?.length) {
    const testName = (id: string) => b.testsDict?.find((t) => t.id === id)?.code ?? id;
    sheet("Field Tests",
      ["athlete_code", "test", "test_date", "value", "attempt"],
      b.testResults.map((r) => [
        athleteLabel(b, r.athlete_id), testName(r.test_id), r.test_date, r.value, r.attempt,
      ]));
  }
  if (b.recommendations?.length) {
    sheet("Recommendations",
      ["athlete_code", "rec_date", "rule", "severity", "decision", "coach_comment"],
      b.recommendations.map((r) => [
        athleteLabel(b, r.athlete_id), r.rec_date, r.rule_key, r.severity,
        r.decision, r.coach_comment ?? "",
      ]));
  }
  sheet("Post-Training Check-ins",
    ["athlete_code", "session_id", "submitted_at", "overall", "legs", "arms", "pain_status", "pain_location", "notes"],
    b.postCheckins.map((p) => [
      athleteLabel(b, p.athlete_id), p.training_session_id, p.submitted_at,
      p.overall_feeling, p.leg_fatigue, p.arm_shoulder_fatigue,
      p.pain_status, p.pain_location ?? "", p.notes ?? "",
    ]));
  sheet("Alerts",
    ["athlete_code", "rule", "severity", "status", "triggered_at", "recommendation", "evidence", "resolution_note"],
    b.alerts.map((a) => [
      athleteLabel(b, a.athlete_id), a.rule_code, a.severity, a.status, a.triggered_at,
      a.recommendation, JSON.stringify(a.evidence), a.resolution_note ?? "",
    ]));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Printable HTML report (browser → Save as PDF). All data is escaped. */
export function buildHtmlReport(b: ExportBundle, title: string): string {
  const rows = (h: string[], data: unknown[][]) =>
    `<table><thead><tr>${h.map((x) => `<th>${escapeHtml(x)}</th>`).join("")}</tr></thead><tbody>${data
      .map((r) => `<tr>${r.map((x) => `<td>${escapeHtml(String(x ?? ""))}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;color:#17233b;margin:24px}h1{font-size:20px}h2{font-size:14px;margin-top:20px}table{border-collapse:collapse;width:100%;font-size:11px}td,th{border:1px solid #e3e8f0;padding:4px 6px;text-align:left}th{background:#f6f8fb}</style>
</head><body>
<h1>${escapeHtml(title)}</h1>
<p>Generated: ${escapeHtml(b.generatedAt)} · TZ: ${escapeHtml(b.timezone)} · Range: ${escapeHtml(b.rangeFrom)} – ${escapeHtml(b.rangeTo)}</p>
<h2>Athletes</h2>${rows(["code", "group", "year", "status"], b.athletes.map((a) => [a.athlete_code, a.group_name ?? "", a.birth_year ?? "", a.status]))}
<h2>Morning Check-ins</h2>${rows(["code", "date", "sleep", "recovery", "fatigue", "soreness", "stress", "mood", "readiness", "pain"], b.morning.map((c) => [athleteLabel(b, c.athlete_id), c.checkin_date, c.sleep_score, c.recovery_score, c.fatigue_score, c.muscle_soreness_score, c.stress_score, c.mood_score, readinessScore(normalizeCheckin(c)), c.pain_status]))}
<h2>Training Sessions</h2>${rows(["code", "date"], b.sessions.map((s) => [athleteLabel(b, s.athlete_id), localDate(new Date(s.started_at), b.timezone)]))}
<h2>Alerts</h2>${rows(["code", "rule", "severity", "status", "at"], b.alerts.map((a) => [athleteLabel(b, a.athlete_id), a.rule_code, a.severity, a.status, a.triggered_at]))}
</body></html>`;
}
