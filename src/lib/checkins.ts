import { localDate } from "@/lib/dates";
import { postsByLocalDate } from "@/lib/readiness";
import type { MorningCheckin, PostTrainingCheckin } from "@/lib/types";

/**
 * Per-calendar-day check-in status — the single place that joins the three
 * already-fetched row sets (morning_checkins, post_training_checkins,
 * training_sessions) onto athlete-local dates.
 *
 * Bucketing rules (identical for every caller):
 *  - morning check-ins are already keyed by checkin_date (athlete-local),
 *  - post-training check-ins are bucketed by postsByLocalDate — when a
 *    sessionDateById map is supplied, a check-in backfilling an earlier
 *    session counts for the session's day, latest submission wins,
 *  - sessions count for the localDate of started_at in the athlete's TZ.
 */

/** Minimal fields postsByLocalDate needs to bucket a post-training check-in. */
type BucketablePost = { submitted_at: string; training_session_id?: string };

/** session id → athlete-local date of the session's start. */
export function sessionDateByIdMap(
  sessions: { id: string; started_at: string }[],
  tz: string,
): Map<string, string> {
  return new Map(
    sessions.map((s) => [s.id, localDate(new Date(s.started_at), tz)]),
  );
}

/** Athlete-local dates on which at least one session was recorded. */
export function sessionLocalDates(
  sessions: { started_at: string }[],
  tz: string,
): Set<string> {
  return new Set(sessions.map((s) => localDate(new Date(s.started_at), tz)));
}

export interface DayStatus<P = PostTrainingCheckin> {
  /** YYYY-MM-DD, athlete-local. */
  date: string;
  /** The day's morning check-in row (one per date), null when missing. */
  morning: MorningCheckin | null;
  /** The morning check-in reports pain (pain_status !== "none"). */
  hasPain: boolean;
  /** The day's post-training check-in (latest submission wins). */
  evening: P | null;
  /** A training session was recorded that local day. */
  hadSession: boolean;
  /** A session was planned for the day; null when no resolver was provided. */
  scheduled: boolean | null;
}

/**
 * Build per-date status for `days` (returned in the same order).
 *
 * Inputs may be raw rows or already-bucketed data — pass `posts` + `tz`
 * (optionally `sessionDateById`) to bucket internally, or `postEntries` when
 * the caller already ran postsByLocalDate (it wins over `posts`). Same for
 * `sessions` + `tz` vs a precomputed `sessionDates` set — useful when the
 * caller deliberately buckets sessions differently (e.g. UTC date slice).
 */
export function dayStatuses<P = PostTrainingCheckin>(input: {
  days: string[];
  checkins?: MorningCheckin[];
  posts?: (P & BucketablePost)[];
  postEntries?: { date: string; post: P }[];
  sessions?: { started_at: string }[];
  sessionDates?: Iterable<string>;
  tz?: string;
  sessionDateById?: Map<string, string>;
  scheduledFor?: (date: string) => boolean | null;
}): DayStatus<P>[] {
  const checkinByDate = new Map(
    (input.checkins ?? []).map((c) => [c.checkin_date, c]),
  );
  const postEntries: { date: string; post: P }[] =
    input.postEntries ??
    postsByLocalDate(input.posts ?? [], input.tz ?? "UTC", input.sessionDateById);
  const postByDate = new Map(postEntries.map((e) => [e.date, e.post]));
  const sessionDates =
    input.sessionDates !== undefined
      ? new Set(input.sessionDates)
      : sessionLocalDates(input.sessions ?? [], input.tz ?? "UTC");

  return input.days.map((date) => {
    const morning = checkinByDate.get(date) ?? null;
    return {
      date,
      morning,
      hasPain: morning !== null && morning.pain_status !== "none",
      evening: postByDate.get(date) ?? null,
      hadSession: sessionDates.has(date),
      scheduled: input.scheduledFor?.(date) ?? null,
    };
  });
}
