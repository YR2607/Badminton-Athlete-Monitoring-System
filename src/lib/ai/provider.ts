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

export async function callAI(opts: {
  system: string;
  user: string;
  jsonSchema: { name: string; strict: boolean; schema: unknown };
  model?: string;
  maxOutputTokens?: number;
}): Promise<AIResult> {
  const key = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "AI API key not configured" };
  const model = opts.model ?? aiModel();
  const base = (process.env.AI_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");

  const body = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    // No response_format — the target free model rejects unknown params
    // with HTTP 400. Output is validated by Zod on our side instead.
    max_tokens: opts.maxOutputTokens ?? 1200,
    temperature: 0.2,
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
        if (attempt === 0 && RETRYABLE.has(res.status)) continue;
        return { ok: false, error: `provider ${res.status}` };
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      const usage: AIUsage = {
        input_tokens: json.usage?.prompt_tokens ?? 0,
        output_tokens: json.usage?.completion_tokens ?? 0,
        model,
        cost_usd: typeof json.usage?.cost === "number" ? json.usage.cost : undefined,
      };
      const text = json.choices?.[0]?.message?.content;
      if (!text) return { ok: false, error: "empty provider response", usage };
      const data = extractJson(text);
      if (data === null) {
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
}
