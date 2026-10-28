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

export type RacketHand = "right" | "left";
export type SessionFocusTag = "lunges" | "smashes" | "endurance" | "technique";
export type MatchDiscipline = "MS" | "WS" | "MD" | "WD" | "XD";
export type MatchResult = "win" | "loss";
export type PlayStyle = "attacking" | "defensive" | "net" | "allround";
export type AttendanceStatus = "present" | "absent" | "excused";
export type AcademyLevel = "beginner" | "intermediate" | "advanced";

export type AcademyItemType =
  | "fact"
  | "single_choice"
  | "multi_choice"
  | "tactical"
  | "find_mistake"
  | "rules"
  | "technique"
  | "physical_recovery"
  | "psychology"
  | "visual_tactical";

export type AcademyTopic =
  | "rules"
  | "technique"
  | "singles_tactics"
  | "doubles_tactics"
  | "game_iq"
  | "footwork"
  | "conditioning"
  | "recovery_prevention"
  | "psychology"
  | "history_facts";

export interface Athlete {
  id: string;
  profile_id: string;
  athlete_code: string;
  birth_year: number | null;
  birth_date: string | null;
  sex: "male" | "female" | null;
  racket_hand?: RacketHand | null;
  mother_height_cm: number | null;
  father_height_cm: number | null;
  photo_path?: string | null;
  preferred_discipline?: MatchDiscipline | null;
  play_style?: PlayStyle | null;
  season_goal?: string | null;
  racket_model?: string | null;
  string_tension_kg?: number | null;
  restrung_on?: string | null;
  academy_level?: AcademyLevel;
  status: AthleteStatus;
  created_at: string;
}

export interface Attendance {
  id: string;
  athlete_id: string;
  att_date: string;
  status: AttendanceStatus;
  marked_by: string | null;
  created_at: string;
}

export interface GrowthMeasurement {
  id: string;
  athlete_id: string;
  measured_on: string;
  height_cm: number;
  weight_kg: number | null;
  sitting_height_cm: number | null;
  entered_by: string | null;
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
  planned_minutes: number | null;
  planned_rpe: number | null;
  active: boolean;
}

export interface MorningCheckin {
  id: string;
  athlete_id: string;
  checkin_date: string;
  submitted_at: string;
  sleep_score: number;
  sleep_hours: number | null;
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
  duration_minutes: number | null;
  session_rpe: number | null;
  session_load: number | null;
  focus_tags?: SessionFocusTag[] | null;
  match_discipline?: MatchDiscipline | null;
  match_result?: MatchResult | null;
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
  z_score: number | null;
  score_norm: { avg: number; sd: number; days: number } | null;
  item_baselines: Record<string, { avg: number; sd: number; days: number } | null> | null;
  item_zscores: Record<string, number | null> | null;
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

export interface FieldTest {
  id: string;
  code: string;
  name: { ru?: string; en?: string; ro?: string };
  unit: string;
  higher_better: boolean;
  instruction: { ru?: string; en?: string; ro?: string };
  sort_order: number;
  active: boolean;
}

export interface FieldTestResult {
  id: string;
  athlete_id: string;
  test_id: string;
  test_date: string;
  value: number;
  attempt: number;
  entered_by: string | null;
  created_at: string;
}

export interface OstrcZone {
  id: string;
  code: string;
  name: { ru?: string; en?: string; ro?: string };
  hint: { ru?: string; en?: string; ro?: string };
  sort_order: number;
  active: boolean;
}

export interface OstrcResponse {
  id: string;
  athlete_id: string;
  week_start_date: string;
  zone_code: string;
  q1: number;
  q2: number | null;
  q3: number | null;
  q4: number | null;
  severity: number;
  substantial: boolean;
  any_problem: boolean;
  onset_date: string | null;
  days_missed: number | null;
  informed: string[];
  other_reason: boolean;
  comment: string | null;
  questionnaire_version: string;
  locale: string | null;
  submitted_at: string;
}

export type EventKind = "competition" | "camp" | "school" | "illness" | "vacation" | "other";

export interface CalendarEvent {
  id: string;
  athlete_id: string | null;
  group_id: string | null;
  kind: EventKind;
  title: string;
  start_date: string;
  end_date: string;
  created_by: string | null;
  created_at: string;
}

export interface Recommendation {
  id: string;
  athlete_id: string;
  rec_date: string;
  rule_key: string;
  severity: "info" | "reduce" | "talk" | "rest" | "medical";
  inputs: Record<string, unknown>;
  decision: "pending" | "accepted" | "modified" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  coach_comment: string | null;
  created_at: string;
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

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  group_ids: string[];
  updated_at: string;
}

export type LocalizedText = { ru: string; en: string; ro: string };

export interface AcademyOption {
  id: string;
  text: LocalizedText;
}

export interface CourtDiagramPlayer {
  id: string;
  label: string;
  team: "you" | "opp";
  x: number; // 0..100 across court width
  y: number; // 0..100 top (opp backline) to bottom (your backline)
}

export interface CourtDiagramArrow {
  from: [number, number];
  to: [number, number];
  label: string;
  tone?: "accent" | "ok" | "warn" | "danger" | "muted";
}

export interface CourtDiagram {
  players: CourtDiagramPlayer[];
  shuttle?: { x: number; y: number };
  arrows?: CourtDiagramArrow[];
}

export interface AcademyItem {
  id: string;
  code: string;
  item_type: AcademyItemType;
  topic: AcademyTopic;
  difficulty: AcademyLevel;
  min_age: number;
  max_age: number;
  title: LocalizedText;
  body: LocalizedText;
  options: AcademyOption[];
  correct_option_ids: string[];
  explanation: LocalizedText;
  source_ref: string | null;
  court_diagram: CourtDiagram | null;
  scheduled_date: string | null;
  target_group_id: string | null;
  published: boolean;
  created_by: string | null;
  created_at: string;
}

/** Client-safe view of AcademyItem: secrets are null until the athlete completes the item. */
export interface PublicAcademyItem {
  id: string;
  code: string;
  item_type: AcademyItemType;
  topic: AcademyTopic;
  difficulty: AcademyLevel;
  min_age: number;
  max_age: number;
  title: LocalizedText;
  body: LocalizedText;
  options: AcademyOption[];
  court_diagram: CourtDiagram | null;
  source_ref: string | null;
  correct_option_ids: string[] | null;
  explanation: LocalizedText | null;
}

export interface AcademyResponse {
  id: string;
  athlete_id: string;
  item_id: string;
  assigned_date: string;
  selected_option_ids: string[];
  is_correct: boolean;
  points_awarded: number;
  duration_sec: number;
  completed_at: string;
}

export interface AcademyTest {
  id: string;
  code: string;
  title: LocalizedText;
  description: LocalizedText;
  topics: AcademyTopic[];
  difficulty: AcademyLevel;
  question_ids: string[];
  question_count: number;
  time_limit_minutes: number | null;
  target_group_id: string | null;
  target_athlete_ids: string[];
  available_from: string;
  available_until: string;
  max_attempts: number;
  published: boolean;
  created_by: string | null;
  created_at: string;
}

export interface AcademyTestAttempt {
  id: string;
  test_id: string;
  athlete_id: string;
  attempt_number: number;
  question_order: string[];
  draft_answers: Record<string, string[]>;
  final_answers: Record<string, string[]>;
  score_pct: number | null;
  correct_count: number;
  total_count: number;
  topic_breakdown: Record<string, { correct: number; total: number }>;
  status: "in_progress" | "submitted" | "expired";
  started_at: string;
  submitted_at: string | null;
}

/** Everything an athlete still has to fill in today — one checklist across
 * morning/post health check-ins, the weekly OSTRC survey and the Academy
 * daily lesson, so kids always see every pending questionnaire. */
export interface TodaySurveyStatus {
  morningDone: boolean;
  postDone: boolean;
  /** A training was scheduled for today (drives the post-check-in hint). */
  scheduledToday: boolean;
  /** OSTRC flag on + parental consent granted → the weekly survey exists. */
  ostrcEnabled: boolean;
  /** OSTRC response already submitted for the current ISO week. */
  ostrcDone: boolean;
  academyOn: boolean;
  /** Cards in today's Academy daily lesson (0 when none available). */
  academyTotal: number;
  /** How many of today's lesson cards are already answered. */
  academyDone: number;
}

