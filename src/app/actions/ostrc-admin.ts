"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, audit } from "@/lib/auth";
import { z } from "zod";

const zoneSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
  ru: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120),
  ro: z.string().trim().min(1).max(120),
  hint_ru: z.string().trim().max(1000).optional(),
  hint_en: z.string().trim().max(1000).optional(),
  hint_ro: z.string().trim().max(1000).optional(),
});

export async function saveOstrcZone(input: unknown) {
  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success) return { error: "validation" };
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { error: "forbidden" };
  const s = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("ostrc_zones").insert({
    code: s.code,
    name: { ru: s.ru, en: s.en, ro: s.ro },
    hint: { ru: s.hint_ru ?? "", en: s.hint_en ?? "", ro: s.hint_ro ?? "" },
  });
  if (error) return { error: error.message };
  await audit("ostrc_zone.create", "ostrc_zones", s.code, {});
  revalidatePath("/admin/ostrc");
  return { ok: true };
}

export async function toggleOstrcZone(zoneId: string, active: boolean) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.from("ostrc_zones").update({ active }).eq("id", zoneId);
  if (error) return { error: error.message };
  revalidatePath("/admin/ostrc");
  return { ok: true };
}
