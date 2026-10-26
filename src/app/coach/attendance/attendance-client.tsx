"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { markGroupPresent, setAttendanceMark } from "@/app/actions/coach";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/lib/types";

export interface AttendanceRow {
  id: string;
  name: string;
  hasSession: boolean;
  status: AttendanceStatus | null;
}

const BTNS: { key: AttendanceStatus; icon: string; active: string }[] = [
  { key: "present", icon: "✅", active: "border-ok bg-ok/15 text-foreground" },
  { key: "absent", icon: "❌", active: "border-danger bg-danger/15 text-foreground" },
  { key: "excused", icon: "🤒", active: "border-warn bg-warn/15 text-foreground" },
];

export function AttendanceClient({
  dict,
  groups,
  groupId,
  date,
  scheduled,
  rows,
}: {
  dict: Dictionary;
  groups: { id: string; name: string }[];
  groupId: string;
  date: string;
  scheduled: boolean | null;
  rows: AttendanceRow[];
}) {
  const router = useRouter();
  const d = dict.attendance;
  const [pending, setPending] = useState<string | null>(null);

  function nav(next: { date?: string; group?: string }) {
    const p = new URLSearchParams();
    const dt = next.date ?? date;
    const g = next.group ?? groupId;
    if (dt) p.set("date", dt);
    if (g) p.set("group", g);
    router.push(`/coach/attendance?${p.toString()}`);
  }

  async function mark(athleteId: string, status: AttendanceStatus | null) {
    const key = `${athleteId}:${status ?? "clear"}`;
    if (pending) return;
    setPending(key);
    const res = await setAttendanceMark({ athlete_id: athleteId, att_date: date, status });
    setPending(null);
    if (res.ok) router.refresh();
    else toast.error(res.error ?? dict.common.error);
  }

  async function allPresent() {
    if (pending) return;
    setPending("all");
    const res = await markGroupPresent({ group_id: groupId, att_date: date });
    setPending(null);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  const label = (s: AttendanceStatus | null) =>
    s === "present" ? d.present : s === "absent" ? d.absent : s === "excused" ? d.excused : null;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div>
            <Label>{d.date}</Label>
            <Input type="date" value={date} onChange={(e) => nav({ date: e.target.value })} />
          </div>
          <div>
            <Label>{d.group}</Label>
            <Select value={groupId} onChange={(e) => nav({ group: e.target.value })}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          {scheduled === false && (
            <Badge tone="neutral" className="mb-2">{d.noSchedule}</Badge>
          )}
          {groupId && rows.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={pending !== null}
              onClick={allPresent}
            >
              ✅ {d.allPresent}
            </Button>
          )}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{d.noGroupData}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const effective = r.status ?? (r.hasSession ? "present" : null);
            const busy = pending !== null;
            return (
              <Card key={r.id}>
                <CardContent className="flex flex-wrap items-center gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="text-xs text-muted">
                      {r.hasSession ? `🏸 ${d.hasSession}` : ""}
                      {r.status && (
                        <button
                          type="button"
                          className="ml-2 underline"
                          onClick={() => mark(r.id, null)}
                          disabled={busy}
                        >
                          {label(r.status)} · ✕
                        </button>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {BTNS.map((b) => (
                      <button
                        key={b.key}
                        type="button"
                        disabled={busy}
                        onClick={() => mark(r.id, r.status === b.key ? null : b.key)}
                        title={d[b.key]}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          effective === b.key
                            ? b.active
                            : "border-border bg-surface text-muted hover:text-foreground",
                          pending === `${r.id}:${b.key}` && "animate-pulse",
                        )}
                      >
                        {b.icon} {d[b.key]}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
