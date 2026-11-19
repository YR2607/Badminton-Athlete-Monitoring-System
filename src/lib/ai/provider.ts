/**
 * Server-only AI provider adapter.
 *
 * Two wire protocols behind one interface:
 *  - "openai"     — official OpenAI Responses API (default, AI_PROVIDER=openai)
 *  - "chat"       — OpenAI-compatible chat/completions (OpenRouter etc.,
 *                   AI_PROVIDER=chat|openrouter|openai-compatible)
 *
 * Reliability (shared): ordered model priority with failover on transient
 * errors (429/5xx/timeout), bounded retries with exponential backoff +
 * jitter, Retry-After support, one strict overall deadline, structured
 * observability logs, in-process dedup + short-lived result caching.
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
  | {
      ok: false;
      error: string;
      usage?: AIUsage;
      raw?: string;
      /** True when the failure is request-level — do NOT try other models. */
      fatal?: boolean;
    };

/** Default model priority per provider — overridable via AI_MODELS (comma-separated). */
const DEFAULT_MODELS_OPENAI = ["gpt-6-luna"] as const;
const DEFAULT_MODELS_CHAT = [
  "dots-studio/dots-3-note-preview:free",
  "baidu/ernie-5.5-flash-preview:free",
  "openrouter/free",
] as const;

const DEFAULT_BASE_OPENAI = "https://api.openai.com/v1";
const DEFAULT_BASE_CHAT = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 90_000;
/** Strict deadline across ALL models/attempts — never retry indefinitely. */
const TOTAL_TIMEOUT_MS = Number(process.env.AI_TOTAL_TIMEOUT_MS) || 300_000;
const MAX_ATTEMPTS_PER_MODEL = 2;
const MAX_REPAIR_PASSES = 2; // initial + one controlled repair attempt
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
/** Model gone/unavailable — worth trying the next configured model. */
const MODEL_GONE_STATUS = new Set([404]);
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 20_000;
const MIN_REMAINING_MS = 3_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type AIProviderKind = "openai" | "chat";

/** AI_PROVIDER=openai (Responses API, default) | chat|openrouter|openai-compatible. */
export function aiProvider(): AIProviderKind {
  const p = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (p === "chat" || p === "openrouter" || p === "openai-compatible" || p === "completions")
    return "chat";
  return "openai";
}

function defaultBase(): string {
  return aiProvider() === "openai" ? DEFAULT_BASE_OPENAI : DEFAULT_BASE_CHAT;
}

function defaultModels(): readonly string[] {
  return aiProvider() === "openai" ? DEFAULT_MODELS_OPENAI : DEFAULT_MODELS_CHAT;
}

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

/** Reasoning-effort cap — reasoning models otherwise burn the token budget
 * on hidden thinking and return empty content. Ignored where unsupported. */
function reasoningParam(): Record<string, unknown> {
  if (process.env.AI_DISABLE_REASONING_PARAM === "true") return {};
  return { reasoning: { effort: process.env.AI_REASONING_EFFORT || "low" } };
}

function parseModelList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Ordered model priority: AI_MODELS > AI_MODEL/AI_FALLBACK_MODEL > provider defaults. */
export function aiModels(): string[] {
  const explicit = parseModelList(process.env.AI_MODELS);
  if (explicit.length) return [...new Set(explicit)];
  const legacyConfigured = Boolean(
    process.env.AI_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      process.env.AI_FALLBACK_MODEL?.trim(),
  );
  if (!legacyConfigured) return [...defaultModels()];
  const primary =
    process.env.AI_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    defaultModels()[0];
  return [...new Set([primary, ...parseModelList(process.env.AI_FALLBACK_MODEL)])];
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

/** Primary model — used for budget reservation estimates. */
export function aiModel(): string {
  return aiModels()[0] ?? defaultModels()[0];
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

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/** Detect stray Chinese/Japanese/Korean characters that some free models leak. */
export function hasCjkCharacters(v: unknown): boolean {
  if (typeof v === "string") return CJK_RE.test(v);
  if (Array.isArray(v)) return v.some(hasCjkCharacters);
  if (v && typeof v === "object") return Object.values(v).some(hasCjkCharacters);
  return false;
}

const REPAIR_HINT =
  "\n\nYour previous reply failed validation. Reply with ONLY the raw JSON object " +
  'of the required shape ({"insufficient":boolean, ...}) — no prose, no markdown fences, and NO Chinese/CJK characters.';

/* ---------- in-process dedup + result cache ---------- */

const RESULT_TTL_MS = 10 * 60_000;
const CACHE_MAX = 50;
const resultCache = new Map<string, { exp: number; res: AIResult }>();
const inflight = new Map<string, Promise<AIResult>>();

function cacheKey(opts: { system: string; user: string }, models: string[]): string {
  // Content hash keeps keys small; cached responses were schema-validated.
  let h = 0;
  const s = opts.system + "" + opts.user;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${aiProvider()}|${models.join("|")}|${s.length}|${h}`;
}

function cacheGet(key: string): AIResult | null {
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    resultCache.delete(key);
    return null;
  }
  return hit.res;
}

function cacheSet(key: string, res: AIResult) {
  if (resultCache.size >= CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest) resultCache.delete(oldest);
  }
  resultCache.set(key, { exp: Date.now() + RESULT_TTL_MS, res });
}

/* ---------- shared attempt plumbing ---------- */

type AttemptOutcome =
  | { kind: "ok"; data: unknown; usage: AIUsage }
  | { kind: "retry"; error: string; usage?: AIUsage; raw?: string; retryAfterMs?: number }
  | { kind: "fatal"; error: string; usage?: AIUsage; raw?: string };

interface AttemptOpts {
  base: string;
  key: string;
  model: string;
  system: string;
  userText: string;
  jsonSchema: { name: string; strict: boolean; schema: unknown };
  maxOutputTokens?: number;
  deadline: number;
}

function usageFromChat(json: {
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}, model: string): AIUsage {
  return {
    input_tokens: json.usage?.prompt_tokens ?? 0,
    output_tokens: json.usage?.completion_tokens ?? 0,
    model,
    cost_usd: typeof json.usage?.cost === "number" ? json.usage.cost : undefined,
  };
}

function usageFromResponses(json: {
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}, model: string): AIUsage {
  return {
    input_tokens: json.usage?.input_tokens ?? 0,
    output_tokens: json.usage?.output_tokens ?? 0,
    model,
  };
}

function httpErrorOutcome(
  res: Response,
  bodyText: string,
  model: string,
  base: string,
  latency: number,
  schemaFormat: boolean,
): { outcome: AttemptOutcome; retryWithoutSchema: boolean } {
  const err = `provider ${res.status}${bodyText ? `:${bodyText.slice(0, 120)}` : ""}`;
  const raRaw = Number(res.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(raRaw) && raRaw > 0 ? raRaw * 1000 : undefined;
  console.info("ai_attempt", {
    model, base, http_status: res.status, latency_ms: latency,
    schema_format: schemaFormat, outcome: "http_error",
  });
  if (res.status === 400 && schemaFormat) {
    // Endpoint rejected strict schema — attempt fn retries once without it.
    return { outcome: { kind: "retry", error: "schema_format_rejected" }, retryWithoutSchema: true };
  }
  if (RETRYABLE_STATUS.has(res.status) || MODEL_GONE_STATUS.has(res.status)) {
    return { outcome: { kind: "retry", error: err, retryAfterMs }, retryWithoutSchema: false };
  }
  return { outcome: { kind: "fatal", error: err }, retryWithoutSchema: false };
}

/* ---------- OpenAI Responses API ---------- */

interface ResponsesApiJson {
  status?: string;
  output_text?: string;
  output?: {
    type?: string;
    content?: { type?: string; text?: string; refusal?: string }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
}

/** Extract assistant text; returns refusal marker when the model refuses. */
function extractResponsesText(json: ResponsesApiJson): { text: string | null; refused: boolean } {
  if (typeof json.output_text === "string" && json.output_text.trim()) {
    return { text: json.output_text, refused: false };
  }
  let text = "";
  let refused = false;
  for (const item of json.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "refusal" || c.refusal) refused = true;
      if (c.type === "output_text" && c.text) text += c.text;
    }
  }
  return { text: text.trim() ? text : null, refused };
}

async function attemptOpenAI(opts: AttemptOpts): Promise<AttemptOutcome> {
  const { base, key, model: m, deadline } = opts;
  const remaining = deadline - Date.now();
  if (remaining < MIN_REMAINING_MS) return { kind: "fatal", error: "deadline_exceeded" };

  const useSchema = process.env.AI_DISABLE_RESPONSE_FORMAT !== "true";
  let withSchema = useSchema;
  for (let schemaTry = 0; schemaTry < 2; schemaTry++) {
    const body: Record<string, unknown> = {
      model: m,
      instructions: opts.system,
      input: opts.userText,
      ...(withSchema
        ? {
            text: {
              format: {
                type: "json_schema",
                name: opts.jsonSchema.name,
                schema: opts.jsonSchema.schema,
                strict: opts.jsonSchema.strict,
              },
            },
          }
        : {}),
      max_output_tokens: opts.maxOutputTokens ?? 2500,
      temperature: 0.2,
      store: false, // never persist athlete prompts on the provider side
      ...reasoningParam(),
      ...extraBody(),
    };
    const started = Date.now();
    try {
      const res = await fetch(`${base}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, Math.max(remaining, 1_000))),
        cache: "no-store",
      });
      const latency = Date.now() - started;
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const { outcome, retryWithoutSchema } = httpErrorOutcome(
          res, bodyText, m, base, latency, withSchema,
        );
        if (retryWithoutSchema) {
          withSchema = false;
          continue;
        }
        return outcome;
      }
      const json = (await res.json()) as ResponsesApiJson;
      const usage = usageFromResponses(json, m);
      // Incomplete (e.g. max_output_tokens) → bounded retry; failed → fatal.
      if (json.status && json.status !== "completed") {
        const reason = json.incomplete_details?.reason ?? json.status;
        console.info("ai_attempt", {
          model: m, base, http_status: 200, latency_ms: latency,
          schema_format: withSchema, outcome: `status_${reason}`,
        });
        if (json.status === "failed" || json.error) {
          return {
            kind: "fatal",
            error: `provider failed:${(json.error?.message ?? reason).slice(0, 120)}`,
            usage,
          };
        }
        return { kind: "retry", error: `provider incomplete:${reason}`, usage };
      }
      const { text, refused } = extractResponsesText(json);
      if (refused) {
        console.info("ai_attempt", {
          model: m, base, http_status: 200, latency_ms: latency,
          schema_format: withSchema, outcome: "refusal",
        });
        return { kind: "fatal", error: "provider refusal", usage };
      }
      if (!text) {
        console.info("ai_attempt", {
          model: m, base, http_status: 200, latency_ms: latency,
          schema_format: withSchema, outcome: "empty_content",
        });
        return { kind: "retry", error: "empty provider response", usage };
      }
      const data = extractJson(text);
      if (data === null) {
        console.error("AI invalid JSON, raw head:", text.slice(0, 300));
        console.info("ai_attempt", {
          model: m, base, http_status: 200, latency_ms: latency,
          schema_format: withSchema, outcome: "invalid_json",
        });
        return { kind: "retry", error: "provider returned invalid JSON", usage, raw: text.slice(0, 200) };
      }
      console.info("ai_attempt", {
        model: m, base, http_status: 200, latency_ms: latency,
        schema_format: withSchema, outcome: "json_parsed",
      });
      return { kind: "ok", data, usage };
    } catch {
      const latency = Date.now() - started;
      console.info("ai_attempt", {
        model: m, base, latency_ms: latency,
        schema_format: withSchema, outcome: "timeout_or_network",
      });
      return { kind: "retry", error: "provider timeout/network error" };
    }
  }
  return { kind: "fatal", error: "unreachable" };
}

/* ---------- OpenAI-compatible chat/completions (OpenRouter etc.) ---------- */

async function attemptChat(opts: AttemptOpts): Promise<AttemptOutcome> {
  const { base, key, model: m, deadline } = opts;
  const remaining = deadline - Date.now();
  if (remaining < MIN_REMAINING_MS) return { kind: "fatal", error: "deadline_exceeded" };

  const useSchema = process.env.AI_DISABLE_RESPONSE_FORMAT !== "true";
  let withSchema = useSchema;
  for (let schemaTry = 0; schemaTry < 2; schemaTry++) {
    const body: Record<string, unknown> = {
      model: m,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.userText },
      ],
      ...(withSchema
        ? { response_format: { type: "json_schema", json_schema: opts.jsonSchema } }
        : {}),
      max_tokens: opts.maxOutputTokens ?? 2500,
      temperature: 0.2,
      ...reasoningParam(),
      ...extraBody(),
    };
    const started = Date.now();
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
        signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, Math.max(remaining, 1_000))),
        cache: "no-store",
      });
      const latency = Date.now() - started;
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const { outcome, retryWithoutSchema } = httpErrorOutcome(
          res, bodyText, m, base, latency, withSchema,
        );
        if (retryWithoutSchema) {
          withSchema = false;
          continue;
        }
        return outcome;
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      const usage = usageFromChat(json, m);
      const text = json.choices?.[0]?.message?.content;
      if (!text) {
        console.info("ai_attempt", {
          model: m, base, http_status: 200, latency_ms: latency,
          schema_format: withSchema, outcome: "empty_content",
        });
        return { kind: "retry", error: "empty provider response", usage };
      }
      const data = extractJson(text);
      if (data === null) {
        console.error("AI invalid JSON, raw head:", text.slice(0, 300));
        console.info("ai_attempt", {
          model: m, base, http_status: 200, latency_ms: latency,
          schema_format: withSchema, outcome: "invalid_json",
        });
        return { kind: "retry", error: "provider returned invalid JSON", usage, raw: text.slice(0, 200) };
      }
      console.info("ai_attempt", {
        model: m, base, http_status: 200, latency_ms: latency,
        schema_format: withSchema, outcome: "json_parsed",
      });
      return { kind: "ok", data, usage };
    } catch {
      const latency = Date.now() - started;
      console.info("ai_attempt", {
        model: m, base, latency_ms: latency,
        schema_format: withSchema, outcome: "timeout_or_network",
      });
      return { kind: "retry", error: "provider timeout/network error" };
    }
  }
  return { kind: "fatal", error: "unreachable" };
}

/* ---------- one model: attempts + one repair pass ---------- */

async function runModel(opts: Omit<AttemptOpts, "userText"> & {
  user: string;
  validate?: (data: unknown) => boolean;
  attempt: (o: AttemptOpts) => Promise<AttemptOutcome>;
}): Promise<AIResult> {
  const { user, validate, attempt, ...rest } = opts;
  const passes = validate ? MAX_REPAIR_PASSES : 1;
  let userText = user;
  let lastData: unknown = null;
  let lastUsage: AIUsage | undefined;

  for (let pass = 0; pass < passes; pass++) {
    let outcome: AttemptOutcome | null = null;
    for (let att = 0; att < MAX_ATTEMPTS_PER_MODEL; att++) {
      if (opts.deadline - Date.now() < MIN_REMAINING_MS) {
        outcome = { kind: "fatal", error: "deadline_exceeded" };
        break;
      }
      outcome = await attempt({ ...rest, userText });
      if (outcome.kind !== "retry") break;
      if (att + 1 < MAX_ATTEMPTS_PER_MODEL) {
        // Exponential backoff + jitter, honoring Retry-After when present.
        const backoff = Math.min(
          BACKOFF_BASE_MS * 2 ** att + Math.floor(Math.random() * 500),
          BACKOFF_CAP_MS,
        );
        const wait = Math.min(
          Math.max(backoff, outcome.retryAfterMs ?? 0),
          Math.max(opts.deadline - Date.now() - MIN_REMAINING_MS, 0),
        );
        if (wait > 0) await sleep(wait);
      }
    }
    if (!outcome) outcome = { kind: "fatal", error: "unreachable" };
    if (outcome.kind === "fatal") {
      return {
        ok: false, error: `${outcome.error}@${opts.model}`,
        usage: outcome.usage, raw: outcome.raw, fatal: true,
      };
    }
    if (outcome.kind === "retry") {
      // Transient/empty/malformed — eligible for next configured model.
      return {
        ok: false, error: `${outcome.error}@${opts.model}`,
        usage: outcome.usage, raw: outcome.raw,
      };
    }
    const cjk = hasCjkCharacters(outcome.data);
    const valid = !cjk && (!opts.validate || opts.validate(outcome.data));
    if (valid) {
      console.info("ai_validation", { model: opts.model, pass, result: "ok" });
      return { ok: true, data: outcome.data, usage: outcome.usage };
    }
    // Parsed but fails validation/CJK — one controlled repair re-ask, then stop.
    lastData = outcome.data;
    lastUsage = outcome.usage;
    userText = `${opts.user}${REPAIR_HINT}\n\nInvalid reply: ${JSON.stringify(outcome.data).slice(0, 300)}`;
  }
  const lastError = hasCjkCharacters(lastData) ? "cjk_output" : "schema_invalid";
  console.info("ai_validation", { model: opts.model, result: lastError });
  return {
    ok: false,
    error: `${lastError}@${opts.model}`,
    usage: lastUsage,
    raw: JSON.stringify(lastData).slice(0, 200),
    fatal: true, // never silently switch models on validation failure
  };
}

/* ---------- public entry: dedup → cache → model chain ---------- */

export async function callAI(opts: {
  system: string;
  user: string;
  jsonSchema: { name: string; strict: boolean; schema: unknown };
  model?: string;
  maxOutputTokens?: number;
  /** When set, a parseable-but-invalid reply triggers one corrective re-ask. */
  validate?: (data: unknown) => boolean;
}): Promise<AIResult> {
  // Env pastes sometimes carry stray whitespace/newlines — a whitespace-only
  // key reaches the provider as `Bearer ` → 401.
  const key = process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) return { ok: false, error: "AI API key not configured" };
  const provider = aiProvider();
  const attempt = provider === "openai" ? attemptOpenAI : attemptChat;
  const models = opts.model ? [opts.model] : aiModels();
  const base = (process.env.AI_BASE_URL ?? defaultBase()).replace(/\/$/, "");

  const ckey = cacheKey(opts, models);
  const cacheOff = process.env.AI_DISABLE_CACHE === "true";
  const cached = cacheOff ? null : cacheGet(ckey);
  if (cached) return cached;
  const pending = inflight.get(ckey);
  if (pending) return pending;

  const run = (async (): Promise<AIResult> => {
    const started = Date.now();
    const deadline = started + TOTAL_TIMEOUT_MS;
    let last: AIResult = { ok: false, error: "unreachable" };
    let fallbacks = 0;
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      if (i > 0) fallbacks++;
      last = await runModel({ ...opts, base, key, model: m, deadline, attempt });
      if (last.ok) {
        console.info("ai_call", {
          provider, model: m, base, fallbacks,
          total_latency_ms: Date.now() - started,
          input_tokens: last.usage.input_tokens,
          output_tokens: last.usage.output_tokens, result: "ok",
        });
        if (!cacheOff) cacheSet(ckey, last);
        return last;
      }
      if (last.fatal) {
        console.info("ai_call", {
          provider, model: m, base, fallbacks,
          total_latency_ms: Date.now() - started,
          result: "fatal", error: last.error.slice(0, 120),
        });
        return last;
      }
      // transient → continue to next configured model
    }
    console.info("ai_call", {
      provider, models, base, fallbacks, total_latency_ms: Date.now() - started,
      result: "all_failed", error: last.error.slice(0, 120),
    });
    return last;
  })();

  inflight.set(ckey, run);
  try {
    return await run;
  } finally {
    inflight.delete(ckey);
  }
}

/* ---------- provider health check (safe, minimal) ---------- */

export interface AIHealth {
  ok: boolean;
  provider: AIProviderKind;
  model: string;
  latency_ms: number;
  error?: string;
}

/** Single cheap probe against the primary model — no athlete data, no cache. */
export async function checkAIHealth(): Promise<AIHealth> {
  const provider = aiProvider();
  const model = aiModel();
  const base = (process.env.AI_BASE_URL ?? defaultBase()).replace(/\/$/, "");
  const started = Date.now();
  const out: AIHealth = { ok: false, provider, model, latency_ms: 0 };
  const key = process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    out.error = "AI API key not configured";
    out.latency_ms = Date.now() - started;
    return out;
  }
  const schema = { name: "health", strict: true, schema: { type: "object", properties: {}, additionalProperties: false } };
  const res = await (provider === "openai" ? attemptOpenAI : attemptChat)({
    base, key, model,
    system: "Reply with the JSON object {} only.",
    userText: "ping",
    jsonSchema: schema,
    maxOutputTokens: 64,
    deadline: started + 30_000,
  });
  out.latency_ms = Date.now() - started;
  if (res.kind === "ok") {
    out.ok = true;
    return out;
  }
  out.error = res.kind === "fatal" ? res.error : `${res.error}`;
  return out;
}
