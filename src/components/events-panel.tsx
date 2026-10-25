"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { saveCalendarEvent, deleteCalendarEvent, saveOwnEvent, deleteOwnEvent } from "@/app/actions/events";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { CalendarEvent, EventKind } from "@/lib/types";

const KIND_TONES: Record<EventKind, "accent" | "warn" | "danger" | "neutral" | "ok"> = {
  competition: "accent",
  camp: "ok",
  school: "neutral",
  illness: "danger",
  vacation: "neutral",
  other: "neutral",
};

/**
 * Context calendar (Phase 5, flag 'events').
 * Staff mode: scope picker athlete/group + all kinds incl. 'illness'.
 * Athlete mode: own events only, kind restricted (no 'illness').
 */
export function EventsPanel({
  dict,
  events,
  athleteId,
  groupId,
  mode,
}: {
  dict: Dictionary;
  events: CalendarEvent[];
  athleteId: string;
  /** Staff only: when set, the form can target the whole group. */
  groupId?: string | null;
  mode: "staff" | "athlete";
}) {
  const d = dict.events;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    kind: (mode === "staff" ? "competition" : "school") as EventKind,
    title: "",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    scope: "athlete" as "athlete" | "group",
  });

  const kindOptions: EventKind[] =
    mode === "staff"
      ? ["competition", "camp", "school", "illness", "vacation", "other"]
      : ["competition", "school", "vacation", "other"];

  async function save() {
    setBusy(true);
    const res =
      mode === "staff"
        ? await saveCalendarEvent({
            athlete_id: f.scope === "athlete" ? athleteId : null,
            group_id: f.scope === "group" ? groupId : null,
            kind: f.kind,
            title: f.title,
            start_date: f.start_date,
            end_date: f.end_date,
          })
        : await saveOwnEvent({
            athlete_id: athleteId,
            kind: f.kind,
            title: f.title,
            start_date: f.start_date,
            end_date: f.end_date,
          });
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      setF({ ...f, title: "" });
      router.refresh();
    } else toast.error(dict.common.error);
  }

  async function remove(id: string) {
    const res = mode === "staff" ? await deleteCalendarEvent(id) : await deleteOwnEvent(id);
    if (res.ok) router.refresh();
    else toast.error(dict.common.error);
  }

  const sorted = events.slice().sort((a, b) => b.start_date.localeCompare(a.start_date));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <div>
            <Label htmlFor="ev-k">{d.kind}</Label>
            <Select
              id="ev-k"
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as EventKind })}
            >
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {d.kinds[k]}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2">
            <Label htmlFor="ev-t">{d.name}</Label>
            <Input
              id="ev-t"
              value={f.title}
              maxLength={200}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ev-s">{d.start}</Label>
            <Input
              id="ev-s"
              type="date"
              value={f.start_date}
              onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value < f.end_date ? f.end_date : e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ev-e">{d.end}</Label>
            <Input
              id="ev-e"
              type="date"
              value={f.end_date}
              min={f.start_date}
              onChange={(e) => setF({ ...f, end_date: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button size="sm" className="w-full" disabled={busy || !f.title.trim()} onClick={save}>
              {d.add}
            </Button>
          </div>
        </div>
        {mode === "staff" && groupId && (
          <div className="flex gap-2 text-xs">
            {(["athlete", "group"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setF({ ...f, scope: s })}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${f.scope === s ? "bg-accent text-accent-foreground" : "bg-foreground/5"}`}
              >
                {s === "athlete" ? d.scopeAthlete : d.scopeGroup}
              </button>
            ))}
          </div>
        )}

        {sorted.length === 0 ? (
          <p className="text-sm text-muted">{d.empty}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {sorted.map((ev) => (
              <li key={ev.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone={KIND_TONES[ev.kind]}>{d.kinds[ev.kind]}</Badge>
                  <span className="truncate">{ev.title}</span>
                  {ev.group_id && (
                    <span className="shrink-0 text-[11px] text-muted">· {d.forGroup}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-muted">
                  {ev.start_date}
                  {ev.end_date !== ev.start_date && ` — ${ev.end_date}`}
                  {(mode === "staff" || ev.athlete_id === athleteId) && (
                    <button
                      type="button"
                      className="text-danger/70 hover:text-danger"
                      title={d.del}
                      onClick={() => remove(ev.id)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
