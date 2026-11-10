import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { estimateCostUsd } from "@/lib/ai/cost";
import { monthlyBudgetUsd, estimateReservationUsd } from "@/lib/ai/budget";

const MIG = readFileSync("supabase/migrations/0028_ai_budget.sql", "utf8");
const ACT = readFileSync("src/app/actions/ai-insights.ts", "utf8");
const CRON = readFileSync("src/app/api/cron/ai-analysis/route.ts", "utf8");

describe("budget guard — migration", () => {
  it("atomic reservation via UPDATE ... WHERE under cap", () => {
    expect(MIG).toContain("reserved_usd + spent_usd + p_est_usd <= p_cap_usd");
    expect(MIG).toContain("return found");
  });
  it("settle releases reservation and adds actual cost", () => {
    expect(MIG).toContain("greatest(reserved_usd - p_reserved_usd, 0)");
    expect(MIG).toContain("spent_usd = spent_usd + p_actual_usd");
  });
  it("monthly reset is implicit (row per month)", () => {
    expect(MIG).toContain("date_trunc('month', current_date)");
  });
  it("budget/rate tables readable by admins only", () => {
    expect(MIG).toMatch(/ai_budget_admin[\s\S]*is_admin/);
    expect(MIG).toMatch(/ai_rate_admin[\s\S]*is_admin/);
  });
});

describe("budget guard — call sites", () => {
  it("every callAI is wrapped by reserve+settle (actions)", () => {
    expect((ACT.match(/reserveBudget/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((ACT.match(/settleBudget/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(ACT).toContain('"budget_exceeded"');
  });
  it("cron checks budget before the provider call", () => {
    expect(CRON.indexOf("reserveBudget")).toBeLessThan(CRON.indexOf("await callAI"));
    expect(CRON).toContain("budget_exceeded");
  });
  it("distributed rate limit replaces in-memory on generation paths", () => {
    expect(ACT).toContain("rateCheck(");
    expect(ACT).not.toContain("checkRateLimit");
  });
});

describe("pricing & config", () => {
  it("cost differs across models", () => {
    expect(estimateCostUsd("gpt-4o", 1_000_000, 0)).toBeGreaterThan(
      estimateCostUsd("gpt-4o-mini", 1_000_000, 0),
    );
  });
  it("budget is env-configurable with sane default", () => {
    delete process.env.AI_MONTHLY_BUDGET_USD;
    expect(monthlyBudgetUsd()).toBe(10);
    process.env.AI_MONTHLY_BUDGET_USD = "25";
    expect(monthlyBudgetUsd()).toBe(25);
    delete process.env.AI_MONTHLY_BUDGET_USD;
  });
  it("reservation estimate is bounded and positive", () => {
    const e = estimateReservationUsd("gpt-4o-mini");
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(0.1);
  });
});
