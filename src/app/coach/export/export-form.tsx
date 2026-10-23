"use client";

import { useState } from "react";
import type { Dictionary } from "@/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import type { Group } from "@/lib/types";

export function ExportForm({
  dict,
  athletes,
  groups,
}: {
  dict: Dictionary;
  athletes: { id: string; label: string }[];
  groups: Group[];
}) {
  const d = dict.export;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [scope, setScope] = useState("all");
  const [athleteId, setAthleteId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [format, setFormat] = useState("xlsx");
  const [notes, setNotes] = useState(false);

  const p = new URLSearchParams({ from, to, format, scope });
  if (scope === "athlete" && athleteId) p.set("athlete_id", athleteId);
  if (scope === "group" && groupId) p.set("group_id", groupId);
  if (notes) p.set("notes", "1");
  const href = `/api/export?${p.toString()}`;

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{dict.common.from}</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>{dict.common.to}</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>{d.scope}</Label>
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">{d.scopeAll}</option>
            <option value="group">{d.scopeGroup}</option>
            <option value="athlete">{d.scopeAthlete}</option>
          </Select>
        </div>
        {scope === "group" && (
          <div>
            <Label>{dict.common.group}</Label>
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {scope === "athlete" && (
          <div>
            <Label>{dict.common.athlete}</Label>
            <SearchSelect
              options={athletes}
              value={athleteId}
              onChange={setAthleteId}
              searchPlaceholder={dict.common.search}
              emptyLabel={dict.common.noResults}
            />
          </div>
        )}
        <div>
          <Label>{d.format}</Label>
          <Select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="xlsx">XLSX (Excel)</option>
            <option value="csv">CSV</option>
            <option value="html">HTML → PDF (print)</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
          {d.dsNotes}
        </label>
        <a
          href={href}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          {d.download}
        </a>
      </CardContent>
    </Card>
  );
}
