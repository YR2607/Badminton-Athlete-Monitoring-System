"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, audit } from "@/lib/auth";
import { fieldTestResultSchema, fieldTestSchema } from "@/lib/validation";

export type ActionResult = { ok?: boolean; error?: string };

async function requireStaff() {
  const profile = await getCurrentProfile();
  if (!profile || !["coach", "admin"].includes(profile.role)) return null;
  return profile;
}

/** Single result for one athlete (profile panel). RLS enforces access. */
export async function addTestResult(input: unknown): Promise<ActionResult> {
  const parsed = fieldTestResultSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await requireStaff();
  if (!profile) return { error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.from("field_test_results").upsert(
    { ...parsed.data, entered_by: profile.id },
    { onConflict: "athlete_id,test_id,test_date,attempt" },
  );
  if (error) return { error: error.message };
  await audit("field_test.add", "field_test_results", parsed.data.athlete_id, {});
  revalidatePath(`/coach/athletes/${parsed.data.athlete_id}`);
  return { ok: true };
}

/**
 * Batch entry for a group session: one test + date, values per athlete.
 * Empty values are skipped. RLS enforces access per row.
 */
export async function saveGroupTestResults(input: {
  test_id: string;
  test_date: string;
  rows: { athlete_id: string; value: number }[];
}): Promise<ActionResult> {
  const profile = await requireStaff();
  if (!profile) return { error: "forbidden" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.test_date)) return { error: "validation" };
  const rows = (input.rows ?? [])
    .filter((r) => r.value !== null && Number.isFinite(r.value))
    .map((r) => ({ ...r, test_id: input.test_id, test_date: input.test_date, attempt: 1 }));
  if (!rows.length) return { error: "validation" };
  for (const r of rows) {
    if (!fieldTestResultSchema.safeParse(r).success) return { error: "validation" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("field_test_results").upsert(
    rows.map((r) => ({ ...r, entered_by: profile.id })),
    { onConflict: "athlete_id,test_id,test_date,attempt" },
  );
  if (error) return { error: error.message };
  await audit("field_test.batch", "field_test_results", input.test_id, {
    date: input.test_date,
    count: rows.length,
  });
  revalidatePath("/coach/tests");
  return { ok: true };
}

export async function deleteTestResult(resultId: string, athleteId: string): Promise<ActionResult> {
  const profile = await requireStaff();
  if (!profile) return { error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.from("field_test_results").delete().eq("id", resultId);
  if (error) return { error: error.message };
  revalidatePath(`/coach/athletes/${athleteId}`);
  return { ok: true };
}

// ---- admin: test dictionary ----

export async function saveFieldTest(input: unknown): Promise<ActionResult> {
  const parsed = fieldTestSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { error: "forbidden" };
  const s = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("field_tests").insert({
    code: s.code,
    name: { ru: s.name_ru, en: s.name_en, ro: s.name_ro },
    unit: s.unit,
    higher_better: s.higher_better,
    instruction: { ru: s.instruction_ru ?? "", en: s.instruction_en ?? "", ro: s.instruction_ro ?? "" },
  });
  if (error) return { error: error.message };
  await audit("field_test.define", "field_tests", s.code, {});
  revalidatePath("/admin/tests");
  return { ok: true };
}

export async function toggleFieldTest(testId: string, active: boolean): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.from("field_tests").update({ active }).eq("id", testId);
  if (error) return { error: error.message };
  revalidatePath("/admin/tests");
  return { ok: true };
}
