import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { FeatureFlag } from "@/lib/types";

/** All flags fetched once per request; evaluate locally. */
export const getFeatureFlags = cache(async (): Promise<FeatureFlag[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("feature_flags").select("*");
  return (data as FeatureFlag[]) ?? [];
});

/**
 * Flag semantics: disabled -> off; enabled + no groups -> on for all;
 * enabled + groups -> on only for athletes currently in a listed group.
 * Without an athlete context (coach/admin screens) a group-scoped flag
 * counts as enabled — the coach then sees it for the right athletes.
 */
export function flagEnabled(
  flags: FeatureFlag[],
  key: string,
  athleteGroupIds?: string[] | null,
): boolean {
  const flag = flags.find((f) => f.key === key);
  if (!flag?.enabled) return false;
  if (flag.group_ids.length === 0) return true;
  if (!athleteGroupIds) return true;
  return flag.group_ids.some((g) => athleteGroupIds.includes(g));
}

/** Convenience for server components: flag check for an athlete's groups. */
export async function isFlagEnabled(key: string, athleteGroupIds?: string[] | null) {
  return flagEnabled(await getFeatureFlags(), key, athleteGroupIds);
}
