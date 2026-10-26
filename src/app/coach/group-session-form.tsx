"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { batchLogGroupSession } from "@/app/actions/coach";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Group, SessionFocusTag } from "@/lib/types";

const FOCUS_KEYS: SessionFocusTag[] = ["lunges", "smashes", "endurance", "technique"];

export function GroupSessionForm({
  groups,
  dict,
}: {
  groups: Group[];
  dict: Dictionary;
}) {
  const router = useRouter();
  const p = dict.pro;
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [minutes, setMinutes] = useState("90");
  const [rpe, setRpe] = useState("6");
  const [tags, setTags] = useState<SessionFocusTag[]>([]);
  const [busy, setBusy] = useState(false);

  if (groups.length === 0) return null;

  const toggleTag = (t: SessionFocusTag) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  async function submit() {
    if (!groupId) return;
    setBusy(true);
    const res = await batchLogGroupSession({
      group_id: groupId,
      duration_minutes: Number(minutes) || 90,
      session_rpe: Number(rpe) || 6,
      focus_tags: tags,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(p.batchSessionSaved.replace("{n}", String(res.count ?? 0)));
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{p.batchSessionTitle}</CardTitle>
        <p className="text-xs text-muted">{p.batchSessionHint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <Label>{dict.common.group}</Label>
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{dict.postTraining.minutes}</Label>
            <Input
              type="number"
              min={1}
              max={600}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
          <div>
            <Label>RPE (0–10)</Label>
            <Input
              type="number"
              min={0}
              max={10}
              value={rpe}
              onChange={(e) => setRpe(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" disabled={busy || !groupId} onClick={submit}>
              {p.batchSessionBtn}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FOCUS_KEYS.map((k) => {
            const on = tags.includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleTag(k)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  on
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-surface text-muted hover:text-foreground",
                )}
              >
                {p.focusTags[k]}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
