import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getDictionary } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

/** Club management overview — counters, org issues, quick actions, groups. */
export default async function AdminHome() {
  const profile = (await getCurrentProfile())!;
  const dict = getDictionary(profile.preferred_language);
  const dd = dict.admin.dash;
  const supabase = await createClient();
  const { getFeatureFlags, flagEnabled } = await import("@/lib/flags");
  const { monthlyBudgetUsd } = await import("@/lib/ai/budget");
  const aiOn = flagEnabled(await getFeatureFlags(), "ai", null);
  let aiRows: { model: string; input_tokens: number; output_tokens: number; endpoint: string | null }[] = [];
  let aiBudget: { reserved_usd: number; spent_usd: number } | null = null;
  if (aiOn) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [u, b] = await Promise.all([
      supabase.from("ai_usage_logs").select("model,input_tokens,output_tokens,endpoint").gte("created_at", monthStart.toISOString()).limit(1000),
      supabase.from("ai_budget_months").select("reserved_usd,spent_usd").eq("month", monthStart.toISOString().slice(0, 10)).maybeSingle(),
    ]);
    aiRows = (u.data as { model: string; input_tokens: number; output_tokens: number; endpoint: string | null }[] | null) ?? [];
    aiBudget = (b.data as { reserved_usd: number; spent_usd: number } | null) ?? null;
  }

  const [
    { count: users },
    { count: coaches },
    { count: athletes },
    { count: groups },
    { count: openAlerts },
    { data: memberships },
    { data: groupRows },
    { data: schedRows },
    { data: activeAthletes },
    { data: auditRows },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "coach"),
    supabase.from("athletes").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("groups").select("id", { count: "exact", head: true }),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("group_memberships").select("athlete_id, group_id").is("left_at", null),
    supabase.from("groups").select("id, name").order("name"),
    supabase.from("training_schedules").select("group_id").eq("active", true),
    supabase.from("athletes").select("id").eq("status", "active"),
    supabase
      .from("audit_logs")
      .select("action, target_type, created_at, actor:profiles!audit_logs_actor_profile_id_fkey(display_name)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const membs = (memberships as { athlete_id: string; group_id: string }[] | null) ?? [];
  const memberGroupIds = new Set(membs.map((m) => m.athlete_id));
  const groupsList = (groupRows as { id: string; name: string }[] | null) ?? [];
  const scheduledGroups = new Set(
    ((schedRows as { group_id: string }[] | null) ?? []).map((s) => s.group_id),
  );
  const athletesNoGroup =
    ((activeAthletes as { id: string }[] | null) ?? []).filter(
      (a) => !memberGroupIds.has(a.id),
    ).length;
  const groupsNoSchedule = groupsList.filter((g) => !scheduledGroups.has(g.id)).length;
  const membersByGroup = new Map<string, number>();
  for (const m of membs) membersByGroup.set(m.group_id, (membersByGroup.get(m.group_id) ?? 0) + 1);

  const issues: { label: string; href: string }[] = [];
  if (athletesNoGroup > 0)
    issues.push({ label: dd.athletesNoGroup.replace("{n}", String(athletesNoGroup)), href: "/admin/groups" });
  if (groupsNoSchedule > 0)
    issues.push({ label: dd.groupsNoSchedule.replace("{n}", String(groupsNoSchedule)), href: "/admin/groups" });

  const tiles: { label: string; v: number | string; href: string }[] = [
    { label: dict.nav.users, v: users ?? 0, href: "/admin/users" },
    { label: dd.coachesN, v: coaches ?? 0, href: "/admin/users" },
    { label: dict.nav.athletes, v: athletes ?? 0, href: "/coach/athletes" },
    { label: dict.nav.groups, v: groups ?? 0, href: "/admin/groups" },
    { label: dict.alerts.open, v: openAlerts ?? 0, href: "/coach/alerts" },
  ];

  const actions: { label: string; href: string }[] = [
    { label: dict.admin.createUser, href: "/admin/users" },
    { label: dict.admin.createGroup, href: "/admin/groups" },
    { label: dict.nav.configuration, href: "/admin/config" },
    { label: dict.nav.coachWorkspace, href: "/coach" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{dict.nav.overview}</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.href + t.label} href={t.href}>
            <Card className="h-full hover:bg-foreground/[0.02]">
              <CardContent className="pt-4">
                <p className="text-2xl font-bold tabular-nums">{t.v}</p>
                <p className="text-xs text-muted">{t.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className={issues.length ? "border-warn/40 bg-warn/5" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{dd.needsAttention}</CardTitle>
        </CardHeader>
        <CardContent>
          {issues.length === 0 ? (
            <p className="text-sm text-muted">✅ {dd.noIssues}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {issues.map((i) => (
                <li key={i.label}>
                  <Link href={i.href} className="text-accent hover:underline">
                    ⚠️ {i.label} →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{dd.quickActions}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:border-accent/50"
            >
              {a.label} →
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{dd.groupsOverview}</CardTitle>
        </CardHeader>
        <CardContent>
          {groupsList.length === 0 ? (
            <p className="text-sm text-muted">{dd.noIssues}</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {groupsList.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href="/admin/groups" className="font-medium text-accent hover:underline">
                    {g.name}
                  </Link>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {dd.membersN.replace("{n}", String(membersByGroup.get(g.id) ?? 0))}
                    {!scheduledGroups.has(g.id) && (
                      <Badge tone="warn">{dd.noSchedule}</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {aiOn && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{dd.aiUsage}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted">{dd.aiBudget}</p>
                <p className="font-semibold">${monthlyBudgetUsd().toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{dd.aiSpent}</p>
                <p className="font-semibold">${(aiBudget?.spent_usd ?? 0).toFixed(4)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{dd.aiRemain}</p>
                <p className="font-semibold">
                  ${Math.max(monthlyBudgetUsd() - (aiBudget?.spent_usd ?? 0) - (aiBudget?.reserved_usd ?? 0), 0).toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">{dd.aiGens}</p>
                <p className="font-semibold">{aiRows.length}</p>
              </div>
            </div>
            {aiRows.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                {dd.aiTokens}: {aiRows.reduce((a, r) => a + r.input_tokens + r.output_tokens, 0).toLocaleString()}
                {" · "}
                {dd.aiByModel}:{" "}
                {Object.entries(
                  aiRows.reduce<Record<string, number>>((acc, r) => {
                    acc[r.model] = (acc[r.model] ?? 0) + 1;
                    return acc;
                  }, {}),
                )
                  .map(([m, n]) => `${m} ×${n}`)
                  .join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {((auditRows as { action: string; target_type: string; created_at: string; actor: { display_name: string } | { display_name: string }[] | null }[] | null) ?? []).length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">{dd.recentActions}</CardTitle>
            <Link href="/admin/audit" className="text-xs font-medium text-accent hover:underline">
              {dict.nav.audit} →
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/60 text-sm">
              {((auditRows as { action: string; target_type: string; created_at: string; actor: { display_name: string } | { display_name: string }[] | null }[] | null) ?? []).map((r, i) => {
                const actor = Array.isArray(r.actor) ? r.actor[0] : r.actor;
                return (
                  <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">
                      {r.action} · {r.target_type}
                      {actor?.display_name ? ` · ${actor.display_name}` : ""}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{r.created_at.slice(0, 10)}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
