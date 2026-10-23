import * as XLSX from "xlsx";
import type {
  Alert,
  Athlete,
  MorningCheckin,
  PostTrainingCheckin,
  ReadinessSnapshot,
  TrainingSession,
} from "@/lib/types";
import { localDate } from "@/lib/dates";
import { normalizeCheckin, readinessScore } from "@/lib/readiness";

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
}

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

function athleteLabel(b: ExportBundle, id: string): string {
  const a = b.athletes.find((x) => x.id === id);
  return a?.athlete_code ?? id;
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
      ["athlete_code", "checkin_date", "submitted_at", "sleep", "recovery", "fatigue", "soreness", "stress", "mood", "readiness", "pain_status", "pain_location", "pain_side", "pain_severity", "swelling", "limitation", "symptoms", "notes"],
      b.morning.map((c) => [
        athleteLabel(b, c.athlete_id), c.checkin_date, c.submitted_at,
        c.sleep_score, c.recovery_score, c.fatigue_score, c.muscle_soreness_score,
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
      ["athlete_code", "started_at", "date", "type", "duration_min", "rpe", "session_load"],
      b.sessions.map((s) => [
        athleteLabel(b, s.athlete_id), s.started_at, localDate(new Date(s.started_at), b.timezone),
        s.training_type, s.duration_minutes, s.session_rpe, s.session_load,
      ]),
    ),
  );
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

export function buildXlsx(b: ExportBundle): Buffer {
  const wb = XLSX.utils.book_new();
  const sheet = (name: string, headers: string[], rows: unknown[][]) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
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
    ["total_load", b.sessions.reduce((x, s) => x + s.session_load, 0)],
    ["total_minutes", b.sessions.reduce((x, s) => x + s.duration_minutes, 0)],
  ]);
  sheet("Athletes", ["athlete_code", "display_name", "group", "birth_year", "status"],
    b.athletes.map((a) => [a.athlete_code, a.display_name ?? "", a.group_name ?? "", a.birth_year ?? "", a.status]));
  sheet("Morning Check-ins",
    ["athlete_code", "checkin_date", "submitted_at", "sleep", "recovery", "fatigue", "soreness", "stress", "mood", "readiness", "pain_status", "pain_location", "pain_side", "pain_severity", "swelling", "limitation", "symptoms", "notes"],
    b.morning.map((c) => [
      athleteLabel(b, c.athlete_id), c.checkin_date, c.submitted_at,
      c.sleep_score, c.recovery_score, c.fatigue_score, c.muscle_soreness_score,
      c.stress_score, c.mood_score, readinessScore(normalizeCheckin(c)),
      c.pain_status, c.pain_location ?? "", c.pain_side ?? "", c.pain_severity ?? "",
      c.swelling ?? "", c.movement_limitation ?? "", c.symptoms ?? "", c.notes ?? "",
    ]));
  sheet("Training Sessions",
    ["athlete_code", "started_at", "date", "type", "duration_min", "rpe", "session_load"],
    b.sessions.map((s) => [
      athleteLabel(b, s.athlete_id), s.started_at, localDate(new Date(s.started_at), b.timezone),
      s.training_type, s.duration_minutes, s.session_rpe, s.session_load,
    ]));
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

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Printable HTML report (browser → Save as PDF). */
export function buildHtmlReport(b: ExportBundle, title: string): string {
  const rows = (h: string[], data: unknown[][]) =>
    `<table><thead><tr>${h.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${data
      .map((r) => `<tr>${r.map((x) => `<td>${String(x ?? "")}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  void escapeHtml;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;color:#17233b;margin:24px}h1{font-size:20px}h2{font-size:14px;margin-top:20px}table{border-collapse:collapse;width:100%;font-size:11px}td,th{border:1px solid #e3e8f0;padding:4px 6px;text-align:left}th{background:#f6f8fb}</style>
</head><body>
<h1>${title}</h1>
<p>Generated: ${b.generatedAt} · TZ: ${b.timezone} · Range: ${b.rangeFrom} – ${b.rangeTo}</p>
<h2>Athletes</h2>${rows(["code", "group", "year", "status"], b.athletes.map((a) => [a.athlete_code, a.group_name ?? "", a.birth_year ?? "", a.status]))}
<h2>Morning Check-ins</h2>${rows(["code", "date", "sleep", "recovery", "fatigue", "soreness", "stress", "mood", "readiness", "pain"], b.morning.map((c) => [athleteLabel(b, c.athlete_id), c.checkin_date, c.sleep_score, c.recovery_score, c.fatigue_score, c.muscle_soreness_score, c.stress_score, c.mood_score, readinessScore(normalizeCheckin(c)), c.pain_status]))}
<h2>Training Sessions</h2>${rows(["code", "date", "type", "min", "rpe", "load"], b.sessions.map((s) => [athleteLabel(b, s.athlete_id), localDate(new Date(s.started_at), b.timezone), s.training_type, s.duration_minutes, s.session_rpe, s.session_load]))}
<h2>Alerts</h2>${rows(["code", "rule", "severity", "status", "at"], b.alerts.map((a) => [athleteLabel(b, a.athlete_id), a.rule_code, a.severity, a.status, a.triggered_at]))}
</body></html>`;
}
