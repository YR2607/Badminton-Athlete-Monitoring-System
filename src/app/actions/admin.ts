"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, audit } from "@/lib/auth";
import type { ActionResult } from "@/app/actions/checkins";
import type { AlertSeverity } from "@/lib/types";

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return null;
  return profile;
}

export async function createGroup(name: string, description?: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { error: "forbidden" };
  const admin = createAdminClient();
  const { error } = await admin.from("groups").insert({ name: name.trim(), description: description ?? null });
  if (error) return { error: error.message };
  await audit("group.create", "groups", null, { name });
  revalidatePath("/admin/groups");
  return { ok: true };
}

export async function addAthleteToGroup(athleteId: string, groupId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { error: "forbidden" };
  const admin = createAdminClient();
  // close existing memberships first (single current group keeps dashboards clear)
  await admin
    .from("group_memberships")
    .update({ left_at: new Date().toISOString() })
    .eq("athlete_id", athleteId)
    .is("left_at", null);
  const { error } = await admin
    .from("group_memberships")
    .insert({ athlete_id: athleteId, group_id: groupId });
  if (error) return { error: error.message };
  await audit("membership.add", "group_memberships", null, { athleteId, groupId });
  revalidatePath("/admin/groups");
  return { ok: true };
}

export async function upsertSchedule(input: {
  id?: string;
  group_id: string;
  weekday: number;
  start_time: string;
  planned_minutes?: number | null;
  planned_rpe?: number | null;
}): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { error: "forbidden" };
  if (input.weekday < 0 || input.weekday > 6) return { error: "validation" };
  if (input.planned_minutes != null && (input.planned_minutes < 1 || input.planned_minutes > 600))
    return { error: "validation" };
  if (input.planned_rpe != null && (input.planned_rpe < 0 || input.planned_rpe > 10))
    return { error: "validation" };
  const admin = createAdminClient();
  const row = {
    group_id: input.group_id,
    weekday: input.weekday,
    start_time: input.start_time,
    planned_minutes: input.planned_minutes ?? null,
    planned_rpe: input.planned_rpe ?? null,
    active: true,
  };
  const { error } = input.id
    ? await admin.from("training_schedules").update(row).eq("id", input.id)
    : await admin.from("training_schedules").insert(row);
  if (error) return { error: error.message };
  await audit("schedule.upsert", "training_schedules", input.id ?? null, input as Record<string, unknown>);
  revalidatePath("/admin/groups");
  return { ok: true };
}

export async function deleteSchedule(id: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { error: "forbidden" };
  const admin = createAdminClient();
  const { error } = await admin.from("training_schedules").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/groups");
  return { ok: true };
}

export async function setAthleteStatus(
  athleteId: string,
  status: "active" | "inactive" | "archived",
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { error: "forbidden" };
  const admin = createAdminClient();
  const { error } = await admin.from("athletes").update({ status }).eq("id", athleteId);
  if (error) return { error: error.message };

  // Block/unblock login so "inactive" actually locks the account.
  const { data: athlete } = await admin
    .from("athletes")
    .select("profile_id")
    .eq("id", athleteId)
    .single();
  const { data: prof } = athlete
    ? await admin.from("profiles").select("user_id").eq("id", athlete.profile_id).single()
    : { data: null };
  if (prof?.user_id) {
    await admin.auth.admin.updateUserById(prof.user_id, {
      ban_duration: status === "active" ? "none" : "876000h",
    });
  }
  await audit("athlete.status", "athletes", athleteId, { status });
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateAlertRule(
  code: string,
  params: Record<string, unknown>,
  enabled: boolean,
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { error: "forbidden" };
  const admin = createAdminClient();
  const { data: current } = await admin.from("alert_rules").select("version").eq("code", code).single();
  const { error } = await admin
    .from("alert_rules")
    .update({ params, enabled, version: (current?.version ?? 1) + 1 })
    .eq("code", code);
  if (error) return { error: error.message };
  await audit("rule.update", "alert_rules", null, { code, params, enabled });
  revalidatePath("/admin/rules");
  return { ok: true };
}

export async function recordConsent(
  athleteId: string,
  consentType: string,
  status: "pending" | "granted" | "revoked",
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { error: "forbidden" };
  const admin = createAdminClient();
  const { error } = await admin.from("consent_records").insert({
    athlete_id: athleteId,
    consent_type: consentType,
    status,
    recorded_by: me.id,
    revoked_at: status === "revoked" ? new Date().toISOString() : null,
  });
  if (error) return { error: error.message };
  await audit("consent.record", "consent_records", null, { athleteId, consentType, status });
  return { ok: true };
}

export type { AlertSeverity };

export async function setFeatureFlag(
  key: string,
  enabled: boolean,
  groupIds: string[],
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { error: "forbidden" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("feature_flags")
    .update({ enabled, group_ids: groupIds, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) return { error: error.message };
  await audit("feature_flag.update", "feature_flags", null, { key, enabled, groupIds });
  revalidatePath("/admin/features");
  return { ok: true };
}
