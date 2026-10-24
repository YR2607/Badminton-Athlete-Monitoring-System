"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { savePlanOverride, deletePlanOverride } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { plannedForDate, weekdayOf, type PlanOverride } from "@/lib/load";
import { addDays } from "@/lib/dates";
import type { Group, TrainingSchedule } from "@/lib/types";

type OverrideRow = PlanOverride & { group_id: string };

interface DayState {
  on: boolean;
  minutes: string;
  rpe: string;
  time: string;
}

export function WeekPlan({
  dict,
  groups,
  schedules,
  overrides,
  today,
}: {
  dict: Dictionary;
  groups: Group[];
  schedules: TrainingSchedule[];
  overrides: OverrideRow[];
  today: string;
}) {
  const d = dict.admin;
  const router = useRouter();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, DayState>>({});

  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(today, i)),
    [today],
  );
  const schedForGroup = schedules.filter((s) => s.group_id === groupId);
  const ovForGroup = overrides.filter((o) => o.group_id === groupId);

  /** Resolved plan for a date as shown in the row (template or override). */
  const resolved = (date: string): DayState => {
    const plan = plannedForDate(date, schedForGroup, ovForGroup);
    const tpl = schedForGroup.find((s) => s.weekday === weekdayOf(date));
    const ov = ovForGroup.find((o) => o.plan_date === date);
    return {
      on: plan.scheduled,
      minutes: plan.planned_minutes != null ? String(plan.planned_minutes) : "",
      rpe: plan.planned_rpe != null ? String(plan.planned_rpe) : "",
      time: (ov?.start_time ?? tpl?.start_time ?? "").slice(0, 5),
    };
  };

  const row = (date: string): DayState => edits[date] ?? resolved(date);
  const setRow = (date: string, patch: Partial<DayState>) =>
    setEdits((e) => ({ ...e, [date]: { ...row(date), ...patch } }));

  const dirty = dates.filter((date) => {
    const e = edits[date];
    return e && JSON.stringify(e) !== JSON.stringify(resolved(date));
  });

  const save = async () => {
    setBusy(true);
    let failed = false;
    for (const date of dirty) {
      const e = edits[date];
      const hasOverride = ovForGroup.some((o) => o.plan_date === date);
      // Row identical to the template resolution → drop the override instead.
      const tplOnly = plannedForDate(date, schedForGroup, []);
      const matchesTemplate =
        e.on === tplOnly.scheduled &&
        (e.minutes ? Number(e.minutes) : null) === tplOnly.planned_minutes &&
        (e.rpe ? Number(e.rpe) : null) === tplOnly.planned_rpe;
      const res = matchesTemplate && hasOverride
        ? await deletePlanOverride(groupId, date)
        : await savePlanOverride({
            group_id: groupId,
            plan_date: date,
            cancelled: !e.on,
            start_time: e.time || null,
            planned_minutes: e.minutes ? Number(e.minutes) : null,
            planned_rpe: e.rpe ? Number(e.rpe) : null,
          });
      if (!res.ok) failed = true;
    }
    setBusy(false);
    if (failed) {
      toast.error(dict.common.error);
    } else {
      toast.success(dict.common.saved);
      setEdits({});
      router.refresh();
    }
  };

  const reset = async (date: string) => {
    setBusy(true);
    const res = await deletePlanOverride(groupId, date);
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      setEdits((e) => {
        const next = { ...e };
        delete next[date];
        return next;
      });
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{d.weekPlan}</CardTitle>
        <p className="text-sm text-muted">{d.weekPlanHint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={groupId} onChange={(e) => { setGroupId(e.target.value); setEdits({}); }}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>

        <div className="space-y-2">
          {dates.map((date) => {
            const r = row(date);
            const hasOverride = ovForGroup.some((o) => o.plan_date === date);
            return (
              <div
                key={date}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm"
              >
                <span className="w-28 font-medium">
                  {d.weekdays[weekdayOf(date)]} {date.slice(5).split("-").reverse().join(".")}
                </span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={r.on}
                    onChange={(e) => setRow(date, { on: e.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                  {r.on ? d.trainingOn : d.restDay}
                </label>
                {r.on && (
                  <>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={600}
                      placeholder={dict.postTraining.minutesUnit}
                      title={d.plannedMinutes}
                      value={r.minutes}
                      onChange={(e) => setRow(date, { minutes: e.target.value })}
                      className="w-20"
                    />
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10}
                      placeholder="RPE"
                      title={d.plannedRpe}
                      value={r.rpe}
                      onChange={(e) => setRow(date, { rpe: e.target.value })}
                      className="w-16"
                    />
                    <Input
                      type="time"
                      value={r.time}
                      onChange={(e) => setRow(date, { time: e.target.value })}
                      className="w-24"
                    />
                  </>
                )}
                {hasOverride && (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600">
                      {d.overrideBadge}
                    </span>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => reset(date)}>
                      {d.resetDay}
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <Button disabled={busy || dirty.length === 0} onClick={save}>
          {dict.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}
