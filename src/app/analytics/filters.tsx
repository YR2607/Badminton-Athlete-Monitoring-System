"use client";

import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n";
import { Input, Select } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { cn } from "@/lib/utils";

export interface AthleteOption {
  id: string;
  label: string;
  groupId: string | null;
}

const RANGE_KEYS: (keyof Dictionary["ranges"])[] = ["day", "yesterday", "7d", "30d", "custom"];

export function AnalyticsFilters({
  dict,
  groups,
  athletes,
  current,
}: {
  dict: Dictionary;
  groups: { id: string; name: string }[];
  athletes: AthleteOption[];
  current: { group: string; athlete: string; range: string; from?: string; to?: string };
}) {
  const router = useRouter();

  function push(next: Partial<typeof current>) {
    const c = { ...current, ...next };
    const p = new URLSearchParams();
    if (c.group) p.set("group", c.group);
    if (c.athlete) p.set("athlete", c.athlete);
    if (c.range) p.set("range", c.range);
    if (c.range === "custom") {
      if (c.from) p.set("from", c.from);
      if (c.to) p.set("to", c.to);
    }
    router.push(`/analytics?${p.toString()}`);
  }

  const athleteOptions = current.group
    ? athletes.filter((a) => a.groupId === current.group)
    : athletes;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={current.group}
          onChange={(e) => push({ group: e.target.value, athlete: "" })}
        >
          <option value="">{dict.analytics.allGroups}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <SearchSelect
          options={athleteOptions}
          value={current.athlete}
          onChange={(id) => push({ athlete: id })}
          allLabel={dict.analytics.scopeAll}
          searchPlaceholder={dict.common.search}
          emptyLabel={dict.common.noResults}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {RANGE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => push({ range: k })}
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              current.range === k ? "bg-accent text-accent-foreground" : "bg-foreground/5",
            )}
          >
            {dict.ranges[k]}
          </button>
        ))}
      </div>
      {current.range === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            value={current.from ?? ""}
            onChange={(e) => push({ from: e.target.value })}
          />
          <Input
            type="date"
            value={current.to ?? ""}
            onChange={(e) => push({ to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
