"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { setFeatureFlag } from "@/app/actions/admin";
import { Card, CardContent } from "@/components/ui/card";
import type { FeatureFlag, Group } from "@/lib/types";

export function FeaturesManager({
  dict,
  flags,
  groups,
}: {
  dict: Dictionary;
  flags: FeatureFlag[];
  groups: Group[];
}) {
  const d = dict.admin.features;
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const save = async (flag: FeatureFlag, enabled: boolean, groupIds: string[]) => {
    setBusyKey(flag.key);
    const res = await setFeatureFlag(flag.key, enabled, groupIds);
    setBusyKey(null);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  };

  const toggleGroup = (flag: FeatureFlag, groupId: string) => {
    const ids = flag.group_ids.includes(groupId)
      ? flag.group_ids.filter((g) => g !== groupId)
      : [...flag.group_ids, groupId];
    void save(flag, flag.enabled, ids);
  };

  return (
    <div className="space-y-3">
      {flags.map((f) => {
        const label = d.items[f.key as keyof typeof d.items] ?? f.key;
        return (
          <Card key={f.key}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{label}</div>
                  {f.description ? (
                    <div className="text-xs text-muted">{f.description}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={busyKey === f.key}
                  onClick={() => void save(f, !f.enabled, f.group_ids)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                    f.enabled ? "bg-accent" : "bg-foreground/20"
                  }`}
                  aria-pressed={f.enabled}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                      f.enabled ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
              {f.enabled && groups.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <span className="text-xs text-muted">
                    {f.group_ids.length === 0 ? d.allGroups : d.selectedGroups}
                  </span>
                  {groups.map((g) => {
                    const on = f.group_ids.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        disabled={busyKey === f.key}
                        onClick={() => toggleGroup(f, g.id)}
                        className={`rounded-full border px-3 py-1 text-xs ${
                          on
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-muted"
                        }`}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
