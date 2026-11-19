import type { AIInsight } from "./schema";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace anonymized athlete_code tokens with display names across any text.
 * Uses non-alphanumeric boundaries so Cyrillic text, #prefixes and punctuation work reliably.
 */
export function replaceAthleteCodes(text: string, names: Record<string, string>): string {
  const codes = Object.keys(names).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!codes.length || !text) return text;
  const byLower = new Map(codes.map((c) => [c.toLowerCase(), names[c]]));
  const re = new RegExp(
    `(?<![A-Za-z0-9_-])(${codes.map(esc).join("|")})(?![A-Za-z0-9_-])`,
    "gi",
  );
  return text.replace(re, (m) => byLower.get(m.toLowerCase()) ?? m);
}

/** Resolve all athlete_code occurrences in every displayed section of an AIInsight. */
export function resolveInsightNames(
  insight: AIInsight,
  names: Record<string, string>,
): AIInsight {
  if (!Object.keys(names).length) return insight;
  const r = (s: string) => replaceAthleteCodes(s, names);
  return {
    ...insight,
    title: r(insight.title),
    observation: r(insight.observation),
    interpretation: r(insight.interpretation),
    sections: insight.sections.map((s) => ({ ...s, finding: r(s.finding) })),
    watch: insight.watch.map((w) => ({
      subject: r(w.subject),
      reason: r(w.reason),
    })),
    positives: insight.positives.map(r),
    questions: insight.questions.map(r),
    evidence: insight.evidence.map((e) => ({
      ...e,
      metric: r(e.metric),
      value: typeof e.value === "string" ? r(e.value) : e.value,
      comparison: e.comparison ? r(e.comparison) : undefined,
      source: r(e.source),
    })),
    recommendations: insight.recommendations.map((rec) => ({
      action: r(rec.action),
      rationale: r(rec.rationale),
    })),
    limitations: insight.limitations.map(r),
  };
}
