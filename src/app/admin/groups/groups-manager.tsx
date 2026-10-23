"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import {
  createGroup,
  addAthleteToGroup,
  assignCoach,
  removeCoachAssignment,
  upsertSchedule,
  deleteSchedule,
} from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import type { CoachAssignment, Group, GroupMembership, TrainingSchedule } from "@/lib/types";

interface Opt {
  id: string;
  label: string;
}

export function GroupsManager({
  dict,
  groups,
  memberships,
  athletes,
  coaches,
  assignments,
  schedules,
}: {
  dict: Dictionary;
  groups: Group[];
  memberships: GroupMembership[];
  athletes: Opt[];
  coaches: Opt[];
  assignments: CoachAssignment[];
  schedules: TrainingSchedule[];
}) {
  const d = dict.admin;
  const router = useRouter();
  const [name, setName] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [coachGroup, setCoachGroup] = useState("");
  const [schedGroup, setSchedGroup] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("16:00");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  };

  const athleteLabel = (id: string) => athletes.find((a) => a.id === id)?.label ?? id;
  const coachLabel = (id: string) => coaches.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{d.createGroup}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={dict.common.name} />
            <Button disabled={busy || !name.trim()} onClick={() => run(() => createGroup(name))}>
              {dict.common.save}
            </Button>
          </div>
          <ul className="divide-y divide-border text-sm">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{g.name}</p>
                  <p className="text-xs text-muted">
                    {memberships.filter((m) => m.group_id === g.id).map((m) => athleteLabel(m.athlete_id)).join(", ") || "—"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{d.addToGroup}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
            <option value="">{dict.common.athlete}…</option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{dict.common.group}…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Button disabled={busy || !athleteId || !groupId} onClick={() => run(() => addAthleteToGroup(athleteId, groupId))}>
            {dict.common.save}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{d.assignCoach}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            <option value="">{dict.common.coach}…</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select value={coachGroup} onChange={(e) => setCoachGroup(e.target.value)}>
            <option value="">{dict.common.group}…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Button
            disabled={busy || !coachId || !coachGroup}
            onClick={() => run(() => assignCoach(coachId, { group_id: coachGroup }))}
          >
            {dict.common.save}
          </Button>
          <ul className="divide-y divide-border text-sm">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span>
                  {coachLabel(a.coach_profile_id)} →{" "}
                  {a.group_id ? groups.find((g) => g.id === a.group_id)?.name : athleteLabel(a.athlete_id!)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => run(() => removeCoachAssignment(a.id))}>
                  {dict.common.delete}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{d.schedule}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={schedGroup} onChange={(e) => setSchedGroup(e.target.value)}>
            <option value="">{dict.common.group}…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{d.weekday}</Label>
              <Select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {d.weekdays.map((w, i) => (
                  <option key={w} value={i}>
                    {w}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{d.startTime}</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>
          <Button
            disabled={busy || !schedGroup}
            onClick={() =>
              run(() => upsertSchedule({ group_id: schedGroup, weekday: Number(weekday), start_time: startTime }))
            }
          >
            {dict.common.save}
          </Button>
          <ul className="divide-y divide-border text-sm">
            {schedules.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>
                  {groups.find((g) => g.id === s.group_id)?.name} · {d.weekdays[s.weekday]} {s.start_time.slice(0, 5)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => run(() => deleteSchedule(s.id))}>
                  {dict.common.delete}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
