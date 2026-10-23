"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/i18n";
import { Input, Select } from "@/components/ui/input";

export interface AuditRow {
  id: string;
  actor_profile_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: { display_name?: string } | null;
}

export function AuditTable({ rows, dict }: { rows: AuditRow[]; dict: Dictionary }) {
  const d = dict.admin;
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [sort, setSort] = useState<string>("newest");

  const actions = useMemo(
    () => [...new Set(rows.map((r) => r.action))].sort(),
    [rows],
  );

  const visible = rows.filter((r) => {
    if (action && r.action !== action) return false;
    if (q) {
      const needle = q.toLowerCase();
      const hay =
        `${r.action} ${r.target_type} ${r.actor?.display_name ?? "system"} ${JSON.stringify(r.metadata)}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  }).sort((a, b) =>
    sort === "oldest"
      ? a.created_at.localeCompare(b.created_at)
      : b.created_at.localeCompare(a.created_at),
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="w-40 flex-1 sm:flex-none"
          placeholder={dict.common.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="w-48" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">{d.allActions}</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select className="w-32" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">{d.sortNewest}</option>
          <option value="oldest">{d.sortOldest}</option>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">{dict.common.date}</th>
              <th className="px-3 py-2 font-medium">{d.actor}</th>
              <th className="px-3 py-2 font-medium">{d.action}</th>
              <th className="px-3 py-2 font-medium">{d.target}</th>
              <th className="px-3 py-2 font-medium">metadata</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-muted">{r.created_at.slice(0, 19).replace("T", " ")}</td>
                <td className="px-3 py-2">{r.actor?.display_name ?? "system"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2 text-muted">{r.target_type}</td>
                <td className="max-w-64 truncate px-3 py-2 text-xs text-muted">
                  {JSON.stringify(r.metadata)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
