// Hand-maintained DB types mirroring supabase/migrations.
// Regenerate-able via `supabase gen types` when a project is linked; kept explicit
// so the codebase typechecks without network access.

export type AppRole = "athlete" | "coach" | "admin";
export type AthleteStatus = "active" | "inactive" | "archived";
export type PainStatus = "none" | "muscle_soreness" | "joint_tendon" | "acute_instability" | "other";
export type PainSide = "left" | "right" | "both" | "na";
export type AlertSeverity = "normal" | "attention" | "review_load" | "priority";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "dismissed";
export type ConfidenceLevel = "sufficient" | "insufficient";
export type NoteKind = "note" | "decision";
export type Locale = "ru" | "ro" | "en";

export interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  role: AppRole;
  preferred_language: Locale;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Athlete {
  id: string;
  profile_id: string;
  athlete_code: string;
  birth_year: number | null;
  status: AthleteStatus;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface GroupMembership {
  id: string;
  group_id: string;
  athlete_id: string;
  joined_at: string;
  left_at: string | null;
}

export interface TrainingSchedule {
  id: string;
  group_id: string;
  weekday: number;
  start_time: string;
  active: boolean;
}

export interface MorningCheckin {
  id: string;
  athlete_id: string;
  checkin_date: string;
  submitted_at: string;
  sleep_score: number;
  recovery_score: number;
  fatigue_score: number;
  muscle_soreness_score: number;
  stress_score: number;
  mood_score: number;
  pain_status: PainStatus;
  pain_location: string | null;
  pain_side: PainSide | null;
  pain_severity: number | null;
  pain_onset: string | null;
  pain_triggers: string[];
  swelling: boolean | null;
  movement_limitation: boolean | null;
  symptoms: string | null;
  notes: string | null;
}

export interface TrainingSession {
  id: string;
  athlete_id: string;
  group_id: string | null;
  started_at: string;
  /** Null unless entered historically — session params are no longer collected. */
  duration_minutes: number | null;
  session_rpe: number | null;
  session_load: number | null;
  created_at: string;
}

export interface PostTrainingCheckin {
  id: string;
  training_session_id: string;
  athlete_id: string;
  submitted_at: string;
  overall_feeling: number;
  leg_fatigue: number;
  arm_shoulder_fatigue: number;
  pain_status: PainStatus;
  pain_location: string | null;
  pain_side: PainSide | null;
  pain_triggers: string[];
  notes: string | null;
}

export interface ReadinessSnapshot {
  id: string;
  athlete_id: string;
  snapshot_date: string;
  calculated_at: string;
  readiness_score: number;
  normalized_scores: NormalizedScores;
  baseline_avg: number | null;
  baseline_sd: number | null;
  baseline_version: number;
  input_data_count: number;
  confidence: ConfidenceLevel;
  explanation: Record<string, unknown>;
}

export interface NormalizedScores {
  sleep: number;
  recovery: number;
  fatigue: number;
  soreness: number;
  stress: number;
  mood: number;
}

export interface AlertRule {
  id: string;
  code: string;
  severity: AlertSeverity;
  enabled: boolean;
  params: Record<string, unknown>;
  description: string;
  version: number;
}

export interface Alert {
  id: string;
  athlete_id: string;
  rule_code: string;
  severity: AlertSeverity;
  triggered_at: string;
  status: AlertStatus;
  evidence: Record<string, unknown>;
  recommendation: string;
  dedup_key: string;
  source_checkin_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution_note: string | null;
}

export interface CoachNote {
  id: string;
  athlete_id: string;
  coach_profile_id: string;
  kind: NoteKind;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  athlete_id: string;
  consent_type: string;
  status: "pending" | "granted" | "revoked";
  recorded_at: string;
  revoked_at: string | null;
}
