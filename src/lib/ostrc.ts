// OSTRC-O2 scoring — Clarsen et al., BJSM 2020.
// Answer values: A=0, B=8, C=17, D=25 for all four key questions.
// Gatekeeper: Q1=A -> zone score 0; Q1=D -> 100 and Q2–Q4 are not asked;
// Q1=B/C -> Q2–Q4 required. severity is ordinal, do not average across a group.

export type OstrcAnswer = 0 | 8 | 17 | 25;
export const OSTRC_VALUES: OstrcAnswer[] = [0, 8, 17, 25];
export const OSTRC_A: OstrcAnswer = 0;
export const OSTRC_D: OstrcAnswer = 25;

export interface OstrcInput {
  q1: OstrcAnswer;
  q2?: OstrcAnswer | null;
  q3?: OstrcAnswer | null;
  q4?: OstrcAnswer | null;
}

/** Validates gatekeeper logic; returns the normalized input or an error key. */
export function validateOstrc(input: OstrcInput): OstrcInput | { error: string } {
  if (!OSTRC_VALUES.includes(input.q1)) return { error: "q1_invalid" };
  const answers = [input.q2, input.q3, input.q4];
  if (answers.some((v) => v !== null && v !== undefined && !OSTRC_VALUES.includes(v))) {
    return { error: "answer_invalid" };
  }
  if (input.q1 === OSTRC_A || input.q1 === OSTRC_D) {
    // Q2–Q4 must not be present when the gatekeeper skips them.
    if (answers.some((v) => v !== null && v !== undefined)) return { error: "gatekeeper_violation" };
    return { q1: input.q1, q2: null, q3: null, q4: null };
  }
  if (answers.some((v) => v === null || v === undefined)) return { error: "answers_required" };
  return { q1: input.q1, q2: input.q2!, q3: input.q3!, q4: input.q4! };
}

/** Severity score 0–100. Assumes a validated input. */
export function ostrcSeverity(input: OstrcInput): number {
  if (input.q1 === OSTRC_A) return 0;
  if (input.q1 === OSTRC_D) return 100;
  return input.q1 + (input.q2 ?? 0) + (input.q3 ?? 0) + (input.q4 ?? 0);
}

/**
 * Substantial problem (Clarsen 2013): Q1=D, or moderate/major change to
 * training (Q2=C/D), or moderate/major effect on performance (Q3=C/D).
 */
export function ostrcSubstantial(input: OstrcInput): boolean {
  if (input.q1 === OSTRC_D) return true;
  return input.q2 === 17 || input.q2 === OSTRC_D || input.q3 === 17 || input.q3 === OSTRC_D;
}

/** Any problem = Q1 other than "full participation, no problems". */
export function ostrcAnyProblem(input: OstrcInput): boolean {
  return input.q1 !== OSTRC_A;
}

/** ISO week Monday (YYYY-MM-DD) of the week containing `date` (YYYY-MM-DD). */
export function isoWeekMonday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.getUTCDay(); // 0 Sun..6 Sat
  d.setUTCDate(d.getUTCDate() - ((wd + 6) % 7));
  return d.toISOString().slice(0, 10);
}
