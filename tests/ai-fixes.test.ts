import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isUniqueViolation } from "@/lib/ai/guard";
import { checkRateLimit } from "@/lib/ai/rate-limit";

const MIGRATION = "supabase/migrations/0027_ai_insights.sql";
const ACTIONS = "src/app/actions/ai-insights.ts";
const CRON = "src/app/api/cron/ai-analysis/route.ts";

describe("fix 1 — ai_usage_logs RLS", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  it("migration grants staff INSERT on ai_usage_logs", () => {
    expect(sql).toMatch(/policy ai_usage_staff_insert on public\.ai_usage_logs\s+for insert/);
    expect(sql).toMatch(/ai_usage_staff_insert[\s\S]*is_admin\(\) or public\.current_role\(\) = 'coach'/);
  });
  it("no anonymous write policies on ai_* tables", () => {
    expect(sql).not.toMatch(/for (insert|all) to anon/);
  });
});

describe("fix 2 — read actions gated by ai flag", () => {
  const src = readFileSync(ACTIONS, "utf8");
  it("getLatestInsight checks the flag", () => {
    const fn = src.slice(src.indexOf("export async function getLatestInsight"), src.indexOf("export async function analyzeAthlete"));
    expect(fn).toContain('isFlagEnabled("ai"');
  });
  it("getLatestGroupInsight checks the flag", () => {
    const fn = src.slice(src.indexOf("export async function getLatestGroupInsight"), src.indexOf("export async function analyzeGroup"));
    expect(fn).toContain('isFlagEnabled("ai"');
  });
});

describe("fix 3 — run-row unique conflicts handled", () => {
  it("isUniqueViolation detects 23505 only", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "42501" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
  const src = readFileSync(ACTIONS, "utf8");
  it("on-demand actions reuse an existing run row on conflict", () => {
    expect(src).toContain("claimRun");
    expect(src).toContain('update({ status: "running", error: null })');
    expect(src).not.toContain("(run as { id: string } | null)?.id ?? null");
  });
});

describe("fix 4 — cron atomic dedup + visible usage errors", () => {
  const src = readFileSync(CRON, "utf8");
  it("cron relies on the atomic insert (23505 skip), not precheck only", () => {
    expect(src).toContain("isUniqueViolation(runErr)");
    expect(src).toContain("run_insert_failed");
  });
  it("final run update is unconditional (runId never silently null)", () => {
    expect(src).not.toContain("if (runId) await admin");
    expect(src).toMatch(/update\(\{ status: "ok", error: usageFailed/);
  });
  it("usage-log failures are logged and surfaced on the run row", () => {
    expect(src).toContain("console.error");
    expect(src).toContain("usage_log_failed");
  });
});

describe("rate limiter boundary", () => {
  it("blocks after max within the window", () => {
    const key = `t:${Date.now()}:${Math.random()}`;
    expect(checkRateLimit(key, 2, 60_000)).toBe(true);
    expect(checkRateLimit(key, 2, 60_000)).toBe(true);
    expect(checkRateLimit(key, 2, 60_000)).toBe(false);
  });
});

describe("phase 3.6 — same-day cache + cost accounting", () => {
  const src = readFileSync("src/app/actions/ai-insights.ts", "utf8");
  it("on-demand returns today's ok-run insight instead of re-billing", () => {
    expect(src).toContain("cachedInsight");
    expect(src).toContain('.eq("status", "ok")');
    expect(src.indexOf('"athlete_on_demand", "athlete"')).toBeLessThan(src.indexOf("await callAI"));
  });
});

describe("cost accounting", () => {
  it("estimates USD from model pricing", async () => {
    const { estimateCostUsd } = await import("@/lib/ai/cost");
    expect(estimateCostUsd("gpt-4o-mini", 1_000_000, 0)).toBe(0.15);
    expect(estimateCostUsd("gpt-4o-mini", 500_000, 500_000)).toBe(0.375);
    expect(estimateCostUsd("unknown-model", 1_000_000, 0)).toBe(0.15);
  });
});
