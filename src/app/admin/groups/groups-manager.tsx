"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import {
  createGroup,
  addAthleteToGroup,
  upsertSchedule,
  deleteSchedule,
} from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import type { Group, GroupMembership, TrainingSchedule } from "@/lib/types";

interface Opt {
  id: string;
  label: string;
}

export function GroupsManager({
  dict,
  groups,
  memberships,
  athletes,
  schedules,
}: {
  dict: Dictionary;
  groups: Group[];
  memberships: GroupMembership[];
  athletes: Opt[];
  schedules: TrainingSchedule[];
}) {
  const d = dict.admin;
  const router = useRouter();
  const [name, setName] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [groupId, setGroupId] = useState("");
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
          <SearchSelect
            options={athletes}
            value={athleteId}
            onChange={setAthleteId}
            placeholder={`${dict.common.athlete}…`}
            searchPlaceholder={dict.common.search}
            emptyLabel={dict.common.noResults}
          />
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
