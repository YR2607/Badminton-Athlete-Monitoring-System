"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { updateAlertRule } from "@/app/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AlertRule } from "@/lib/types";

const sevTone: Record<string, "danger" | "warn" | "accent" | "neutral"> = {
  priority: "danger",
  review_load: "warn",
  attention: "accent",
  normal: "neutral",
};

type Unit = keyof Dictionary["rules"]["units"];
type FieldKey = keyof Dictionary["rules"]["fields"];
interface FieldDef {
  key: FieldKey;
  min: number;
  max: number;
  step: number;
  unit?: Unit;
}

/** Coach-editable numeric params per rule. Other params stay untouched on save. */
const FIELDS: Record<string, FieldDef[]> = {
  acute_pain: [{ key: "min_severity", min: 1, max: 10, step: 1, unit: "of10" }],
  illness_symptoms: [],
  joint_pain: [{ key: "min_severity", min: 1, max: 10, step: 1, unit: "of10" }],
  readiness_drop: [
    { key: "sd_below", min: 0.5, max: 3, step: 0.25 },
    { key: "min_abs_drop", min: 5, max: 30, step: 1, unit: "points" },
  ],
  sustained_decline: [{ key: "days", min: 2, max: 7, step: 1 }],
  load_spike: [{ key: "ratio", min: 1.1, max: 3, step: 0.1, unit: "times" }],
  load_with_decline: [{ key: "load_ratio", min: 1.1, max: 2.5, step: 0.1, unit: "times" }],
  repeated_fatigue: [
    { key: "days", min: 2, max: 7, step: 1 },
    { key: "fatigue_min", min: 1, max: 5, step: 1, unit: "of5" },
  ],
  missing_morning: [{ key: "after_local_hour", min: 8, max: 18, step: 1, unit: "hour" }],
};

function paramNumber(rule: AlertRule, f: FieldDef): number {
  const v = rule.params[f.key];
  return typeof v === "number" && Number.isFinite(v) ? v : f.min;
}

function Switch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors",
        on ? "bg-ok" : "bg-foreground/20",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function RulesEditor({ dict, rules }: { dict: Dictionary; rules: AlertRule[] }) {
  const router = useRouter();
  const d = dict.rules;
  const [values, setValues] = useState<Record<string, Record<string, number>>>(() =>
    Object.fromEntries(
      rules.map((r) => [
        r.code,
        Object.fromEntries((FIELDS[r.code] ?? []).map((f) => [f.key, paramNumber(r, f)])),
      ]),
    ),
  );
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function save(rule: AlertRule, enabled: boolean) {
    setBusy(rule.code);
    const params = { ...rule.params, ...(values[rule.code] ?? {}) };
    const res = await updateAlertRule(rule.code, params, enabled);
    setBusy(null);
    if (res.ok) {
      toast.success(dict.common.saved);
      setDirty((s) => ({ ...s, [rule.code]: false }));
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{d.subtitle}</p>
      {rules.map((r) => {
        const item = d.items[r.code as keyof typeof d.items];
        const fields = FIELDS[r.code] ?? [];
        return (
          <Card key={r.code}>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{item?.name ?? r.code}</h3>
                    <Badge tone={sevTone[r.severity]}>
                      {dict.alerts.severity[r.severity as keyof typeof dict.alerts.severity]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">{item?.desc ?? r.description}</p>
                </div>
                <Switch
                  on={r.enabled}
                  label={r.enabled ? d.off : d.on}
                  onToggle={() => save(r, !r.enabled)}
                />
              </div>

              {r.enabled && fields.length > 0 && (
                <div className="space-y-4 rounded-xl bg-foreground/[0.03] p-3">
                  {fields.map((f) => {
                    const val = values[r.code]?.[f.key] ?? f.min;
                    return (
                      <div key={f.key}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          <span>{d.fields[f.key]}</span>
                          <span className="shrink-0 rounded-md bg-surface px-2 py-0.5 font-medium tabular-nums">
                            {f.key === "sd_below" ? `${val} σ` : val}
                            {f.unit ? ` ${d.units[f.unit]}` : ""}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          value={val}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setValues((s) => ({
                              ...s,
                              [r.code]: { ...s[r.code], [f.key]: v },
                            }));
                            setDirty((s) => ({ ...s, [r.code]: true }));
                          }}
                          className="h-8 w-full accent-[var(--accent)]"
                        />
                      </div>
                    );
                  })}
                  {dirty[r.code] && (
                    <Button size="sm" disabled={busy === r.code} onClick={() => save(r, r.enabled)}>
                      {dict.common.save}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
