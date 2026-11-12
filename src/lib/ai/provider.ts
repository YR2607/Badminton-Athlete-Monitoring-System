/**
 * Server-only AI provider adapter — OpenAI-compatible chat/completions API.
 * Works with OpenRouter (default), OpenAI, or any compatible endpoint.
 * Keys never leave the server.
 */

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
  /** Real billed cost when the provider reports it (OpenRouter usage.cost). */
  cost_usd?: number;
}

export type AIResult =
  | { ok: true; data: unknown; usage: AIUsage }
  | { ok: false; error: string; usage?: AIUsage; raw?: string };

export const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const DEFAULT_BASE = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = 45_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Provider-specific body extras via env, e.g. NIM thinking switch:
 * AI_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":false}} */
function extraBody(): Record<string, unknown> {
  try {
    const raw = process.env.AI_EXTRA_BODY;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY);
}

export function aiModel(): string {
  return process.env.AI_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
}

/**
 * Parse raw JSON; fall back to extracting a JSON object from prose.
 * Reasoning models emit thinking + fenced blocks — scan all balanced
 * {...} spans, prefer the LAST object containing our root key.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/```(?:json)?/g, "");
  const direct = safeParse(trimmed);
  if (direct !== null) return direct;
  // Balanced-brace spans, last-to-first.
  const spans: string[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) spans.push(trimmed.slice(start, i + 1));
    }
  }
  for (const span of spans.reverse()) {
    if (!span.includes('"insufficient"')) continue;
    const parsed = safeParse(span);
    if (parsed !== null) return parsed;
  }
  for (const span of spans) {
    const parsed = safeParse(span);
    if (parsed !== null) return parsed;
  }
  return null;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const REPAIR_HINT =
  "\n\nYour previous reply failed validation. Reply with ONLY the raw JSON object " +
  'of the required shape ({"insufficient":boolean, ...}) — no prose, no markdown fences.';

export async function callAI(opts: {
  system: string;
  user: string;
  jsonSchema: { name: string; strict: boolean; schema: unknown };
  model?: string;
  maxOutputTokens?: number;
  /** When set, a parseable-but-invalid reply triggers one corrective re-ask. */
  validate?: (data: unknown) => boolean;
}): Promise<AIResult> {
  const key = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "AI API key not configured" };
  const model = opts.model ?? aiModel();
  const base = (process.env.AI_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

  const request = async (m: string, userText: string): Promise<AIResult> => {
    const body = {
      model: m,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: userText },
      ],
      // No response_format — the target free model rejects unknown params
      // with HTTP 400. Output is validated by Zod on our side instead.
      max_tokens: opts.maxOutputTokens ?? 4000,
      temperature: 0.2,
      ...extraBody(),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://badminton-athlete-monitoring-system.vercel.app",
            "X-Title": "RallyMonitor AI Coach",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
        if (!res.ok) {
          if (attempt === 0 && RETRYABLE.has(res.status)) {
            // Honor Retry-After on 429; a plain short backoff otherwise.
            const ra = Number(res.headers.get("retry-after"));
            await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : 1500);
            continue;
          }
          return { ok: false, error: `provider ${res.status}` };
        }
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        };
        const usage: AIUsage = {
          input_tokens: json.usage?.prompt_tokens ?? 0,
          output_tokens: json.usage?.completion_tokens ?? 0,
          model: m,
          cost_usd: typeof json.usage?.cost === "number" ? json.usage.cost : undefined,
        };
        const text = json.choices?.[0]?.message?.content;
        if (!text) {
          if (attempt === 0) continue;
          return { ok: false, error: "empty provider response", usage };
        }
        const data = extractJson(text);
        if (data === null) {
          if (attempt === 0) continue;
          console.error("AI invalid JSON, raw head:", text.slice(0, 300));
          return { ok: false, error: "provider returned invalid JSON", usage, raw: text.slice(0, 200) };
        }
        return { ok: true, data, usage };
      } catch {
        if (attempt === 0) continue;
        return { ok: false, error: "provider timeout/network error" };
      }
    }
    return { ok: false, error: "unreachable" };
  };

  const run = async (m: string): Promise<AIResult> => {
    const passes = opts.validate ? 2 : 1;
    let userText = opts.user;
    let lastData: unknown = null;
    let lastUsage: AIUsage | undefined;
    for (let pass = 0; pass < passes; pass++) {
      const res = await request(m, userText);
      if (!res.ok) return res;
      if (!opts.validate || opts.validate(res.data)) return res;
      lastData = res.data;
      lastUsage = res.usage;
      userText = `${opts.user}${REPAIR_HINT}\n\nInvalid reply: ${JSON.stringify(res.data).slice(0, 300)}`;
    }
    return {
      ok: false,
      error: "schema_invalid",
      usage: lastUsage,
      raw: JSON.stringify(lastData).slice(0, 200),
    };
  };

  // Free-tier models rotate and rate-limit — retry the whole thing on a
  // configured fallback before giving up.
  const models = [...new Set([model, process.env.AI_FALLBACK_MODEL].filter(Boolean))] as string[];
  let last: AIResult = { ok: false, error: "unreachable" };
  for (const m of models) {
    last = await run(m);
    if (last.ok) return last;
  }
  return last;
}
