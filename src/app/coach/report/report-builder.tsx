"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n";

const COL_KEYS = ["fill", "score", "au", "pain", "att", "alerts"] as const;
type ColKey = (typeof COL_KEYS)[number];

const COL_LABEL: Record<ColKey, keyof Dictionary["report"]> = {
  fill: "colFill",
  score: "colScore",
  au: "colAU",
  pain: "colPain",
  att: "colAtt",
  alerts: "colAlerts",
};

/** Report builder — pick a group or athlete, a period and which group columns to include. */
export function ReportBuilder({
  groups,
  athletes,
  d,
}: {
  groups: { id: string; name: string }[];
  athletes: { id: string; name: string }[];
  d: Dictionary["report"];
}) {
  const router = useRouter();
  const first = groups[0] ? `group:${groups[0].id}` : athletes[0] ? `athlete:${athletes[0].id}` : "";
  const [target, setTarget] = useState(first);
  const [period, setPeriod] = useState<"7d" | "month" | "custom">("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cols, setCols] = useState<Set<ColKey>>(new Set(COL_KEYS));

  const isGroup = target.startsWith("group:");
  const canSubmit =
    target !== "" && (period !== "custom" || (from !== "" && to !== "")) && (!isGroup || cols.size > 0);

  const toggle = (c: ColKey) =>
    setCols((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const submit = () => {
    const [kind, id] = target.split(":");
    const p = new URLSearchParams({ [kind]: id, period });
    if (period === "custom") {
      p.set("from", from);
      p.set("to", to);
    }
    if (isGroup) p.set("cols", COL_KEYS.filter((c) => cols.has(c)).join(","));
    router.push(`/coach/report?${p.toString()}`);
  };

  const input =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm";

  return (
    <section className="space-y-4 rounded-xl border border-border p-4">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">{d.pickTarget}</span>
        <select className={`${input} w-full`} value={target} onChange={(e) => setTarget(e.target.value)}>
          {groups.length > 0 && (
            <optgroup label={d.optGroups}>
              {groups.map((g) => (
                <option key={g.id} value={`group:${g.id}`}>{g.name}</option>
              ))}
            </optgroup>
          )}
          <optgroup label={d.optAthletes}>
            {athletes.map((a) => (
              <option key={a.id} value={`athlete:${a.id}`}>{a.name}</option>
            ))}
          </optgroup>
        </select>
      </label>

      <div className="space-y-1">
        <span className="text-xs font-medium text-muted">{d.periodLabel}</span>
        <div className="flex gap-2">
          {(["7d", "month", "custom"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                period === p ? "border-accent bg-accent/10 text-accent" : "border-border"
              }`}
            >
              {p === "7d" ? d.p7d : p === "month" ? d.pMonth : d.pCustom}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-muted">{d.fromLabel}</span>
            <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-xs text-muted">{d.toLabel}</span>
            <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      {isGroup && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted">{d.columnsLabel}</span>
          <div className="flex flex-wrap gap-2">
            {COL_KEYS.map((c) => (
              <label
                key={c}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                  cols.has(c) ? "border-accent bg-accent/10" : "border-border text-muted"
                }`}
              >
                <input
                  type="checkbox"
                  checked={cols.has(c)}
                  onChange={() => toggle(c)}
                  className="accent-current"
                />
                {d[COL_LABEL[c]]}
              </label>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {d.build}
      </button>
    </section>
  );
}
