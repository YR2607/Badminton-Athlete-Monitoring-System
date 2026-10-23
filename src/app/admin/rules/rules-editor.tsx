"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { updateAlertRule } from "@/app/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import type { AlertRule } from "@/lib/types";

const sevTone: Record<string, "danger" | "warn" | "accent" | "neutral"> = {
  priority: "danger",
  review_load: "warn",
  attention: "accent",
  normal: "neutral",
};

export function RulesEditor({ dict, rules }: { dict: Dictionary; rules: AlertRule[] }) {
  const router = useRouter();
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(rules.map((r) => [r.code, JSON.stringify(r.params)])),
  );

  async function save(rule: AlertRule, enabled: boolean) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(params[rule.code] ?? "{}");
    } catch {
      toast.error("Invalid JSON");
      return;
    }
    const res = await updateAlertRule(rule.code, parsed, enabled);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  return (
    <div className="space-y-3">
      {rules.map((r) => (
        <Card key={r.code}>
          <CardContent className="space-y-2 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-semibold">{r.code}</code>
              <Badge tone={sevTone[r.severity]}>
                {dict.alerts.severity[r.severity as keyof typeof dict.alerts.severity]}
              </Badge>
              <Badge tone={r.enabled ? "ok" : "neutral"}>{r.enabled ? "on" : "off"}</Badge>
              <span className="text-xs text-muted">v{r.version}</span>
            </div>
            <p className="text-sm text-muted">{r.description}</p>
            <Textarea
              className="font-mono text-xs"
              value={params[r.code] ?? "{}"}
              onChange={(e) => setParams({ ...params, [r.code]: e.target.value })}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save(r, r.enabled)}>
                {dict.common.save}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => save(r, !r.enabled)}>
                {r.enabled ? dict.admin.deactivate : dict.admin.activate}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
