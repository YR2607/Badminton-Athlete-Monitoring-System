"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { coachUpsertMorningCheckin } from "@/app/actions/coach";
import { ScaleInput } from "@/components/forms/scale-input";
import { BodyMapPicker } from "@/components/forms/body-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PainSide, PainStatus } from "@/lib/types";

export interface KioskAthlete {
  id: string;
  name: string;
  code: string;
  groupName: string;
  today: string;
}

const PAIN_KEYS = ["painNone", "painMuscle", "painJoint", "painAcute", "painOther"] as const;
const PAIN_VALS: PainStatus[] = ["none", "muscle_soreness", "joint_tendon", "acute_instability", "other"];

export function KioskClient({
  athletes,
  dict,
}: {
  athletes: KioskAthlete[];
  dict: Dictionary;
}) {
  const router = useRouter();
  const d = dict.morning;
  const p = dict.pro;
  const [queue, setQueue] = useState<KioskAthlete[]>(athletes);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  const [sleep, setSleep] = useState<number | undefined>(8);
  const [sleepHours, setSleepHours] = useState<string>("8");
  const [recovery, setRecovery] = useState<number | undefined>(8);
  const [fatigue, setFatigue] = useState<number | undefined>(3);
  const [soreness, setSoreness] = useState<number | undefined>(2);
  const [stress, setStress] = useState<number | undefined>(2);
  const [mood, setMood] = useState<number | undefined>(8);
  const [painStatus, setPainStatus] = useState<PainStatus>("none");
  const [painLocation, setPainLocation] = useState("");
  const [painSide, setPainSide] = useState<PainSide | undefined>(undefined);
  const [painSeverity, setPainSeverity] = useState<number | undefined>(5);

  const current = queue[idx] ?? null;

  const resetForm = () => {
    setSleep(8);
    setSleepHours("8");
    setRecovery(8);
    setFatigue(3);
    setSoreness(2);
    setStress(2);
    setMood(8);
    setPainStatus("none");
    setPainLocation("");
    setPainSide(undefined);
    setPainSeverity(5);
  };

  if (!current) {
    return (
      <Card>
        <CardContent className="space-y-4 py-8 text-center">
          <p className="text-lg font-semibold text-ok">✓ {p.kioskAllDone}</p>
          <Link href="/coach">
            <Button>{dict.day.backToAthlete.replace(dict.common.athlete.toLowerCase(), dict.coach.dashboard)}</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const hints = {
    good: dict.common.scaleHintGood,
    mid: dict.common.scaleHintMid,
    bad: dict.common.scaleHintBad,
  };

  async function saveAndNext() {
    if (!sleep || !recovery || !fatigue || !soreness || !stress || !mood) {
      toast.error(dict.common.fillAllScales);
      return;
    }
    setBusy(true);
    const res = await coachUpsertMorningCheckin({
      athlete_id: current.id,
      checkin_date: current.today,
      sleep_score: sleep,
      sleep_hours: sleepHours ? Number(sleepHours) : null,
      recovery_score: recovery,
      fatigue_score: fatigue,
      muscle_soreness_score: soreness,
      stress_score: stress,
      mood_score: mood,
      pain_status: painStatus,
      pain_location: painStatus !== "none" ? painLocation || null : null,
      pain_side: painStatus !== "none" ? (painSide ?? null) : null,
      pain_severity: painStatus !== "none" ? (painSeverity ?? 5) : null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(p.kioskSavedNext);
      const nextQueue = queue.filter((a) => a.id !== current.id);
      setQueue(nextQueue);
      setIdx((i) => (i >= nextQueue.length ? 0 : i));
      resetForm();
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-accent/40 bg-accent/5">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-xl">
                {current.name}{" "}
                <span className="text-sm font-normal text-muted">
                  ({current.code} · {current.groupName})
                </span>
              </CardTitle>
              <p className="text-xs text-muted">
                {p.kioskRemaining.replace("{n}", String(queue.length))}
              </p>
            </div>
            {queue.length > 1 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  resetForm();
                  setIdx((i) => (i + 1) % queue.length);
                }}
              >
                {p.kioskSkip}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5 pt-1">
          {queue.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                resetForm();
                setIdx(i);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                i === idx
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface text-muted",
              )}
            >
              {a.name}
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div>
            <p className="mb-2 text-sm font-medium">{d.sleep}</p>
            <ScaleInput
              value={sleep}
              onChange={setSleep}
              lowLabel={d.sleepLow}
              highLabel={d.sleepHigh}
              hints={hints}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="k-sh" className="mb-0">
              {d.sleepHours}:
            </Label>
            <Input
              id="k-sh"
              type="number"
              step={0.5}
              min={0}
              max={16}
              value={sleepHours}
              onChange={(e) => setSleepHours(e.target.value)}
              className="w-24"
            />
            <span className="text-xs text-muted">{d.sleepHoursUnit}</span>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{d.recovery}</p>
            <ScaleInput
              value={recovery}
              onChange={setRecovery}
              lowLabel={d.recoveryLow}
              highLabel={d.recoveryHigh}
              hints={hints}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{d.fatigue}</p>
            <ScaleInput
              value={fatigue}
              onChange={setFatigue}
              lowLabel={d.fatigueLow}
              highLabel={d.fatigueHigh}
              inverted
              hints={hints}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{d.soreness}</p>
            <ScaleInput
              value={soreness}
              onChange={setSoreness}
              lowLabel={d.sorenessLow}
              highLabel={d.sorenessHigh}
              inverted
              hints={hints}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{d.stress}</p>
            <ScaleInput
              value={stress}
              onChange={setStress}
              lowLabel={d.stressLow}
              highLabel={d.stressHigh}
              inverted
              hints={hints}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{d.mood}</p>
            <ScaleInput
              value={mood}
              onChange={setMood}
              lowLabel={d.moodLow}
              highLabel={d.moodHigh}
              hints={hints}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm font-medium">{d.painQuestion}</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {PAIN_VALS.map((v, i) => (
              <button
                key={v}
                type="button"
                onClick={() => setPainStatus(v)}
                className={cn(
                  "rounded-lg border px-2.5 py-2 text-left text-xs font-medium",
                  painStatus === v
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-surface",
                )}
              >
                {d[PAIN_KEYS[i]]}
              </button>
            ))}
          </div>
          {painStatus !== "none" && (
            <div className="space-y-3 pt-2">
              <BodyMapPicker
                zonesDict={p.bodyZones}
                title={p.bodyMapTitle}
                location={painLocation}
                side={painSide}
                onSelect={(lbl, s) => {
                  setPainLocation(lbl);
                  if (s) setPainSide(s);
                }}
              />
              <div>
                <p className="mb-1.5 text-xs font-medium">{d.painSeverity}</p>
                <ScaleInput
                  value={painSeverity}
                  onChange={setPainSeverity}
                  inverted
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Button size="lg" className="w-full" disabled={busy} onClick={saveAndNext}>
        {busy ? d.submitting : `${dict.common.save} → ${current.name}`}
      </Button>
    </div>
  );
}
