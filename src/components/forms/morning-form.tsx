"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { submitMorningCheckin } from "@/app/actions/checkins";
import { ScaleInput } from "@/components/forms/scale-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MorningCheckin } from "@/lib/types";

const schema = z.object({
  sleep_score: z.number().min(1).max(10),
  sleep_hours: z.number().min(0).max(16).optional().nullable(),
  recovery_score: z.number().min(1).max(10),
  fatigue_score: z.number().min(1).max(10),
  muscle_soreness_score: z.number().min(1).max(10),
  stress_score: z.number().min(1).max(10),
  mood_score: z.number().min(1).max(10),
  pain_status: z.enum(["none", "muscle_soreness", "joint_tendon", "acute_instability", "other"]),
  pain_location: z.string().optional(),
  pain_side: z.enum(["left", "right", "both", "na"]).optional(),
  pain_severity: z.number().min(1).max(10).optional(),
  pain_onset: z.string().optional(),
  pain_triggers: z.array(z.string()).default([]),
  swelling: z.boolean().optional(),
  movement_limitation: z.boolean().optional(),
  symptoms: z.string().optional(),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const painKeys = ["painNone", "painMuscle", "painJoint", "painAcute", "painOther"] as const;
const painValues = ["none", "muscle_soreness", "joint_tendon", "acute_instability", "other"] as const;
const triggerKeys = ["triggerWalking", "triggerJumping", "triggerLunges", "triggerRest"] as const;
const triggerValues = ["walking", "jumping", "lunges", "rest"] as const;
const sideKeys = ["sideLeft", "sideRight", "sideBoth", "sideNa"] as const;
const sideValues = ["left", "right", "both", "na"] as const;

/**
 * Only the dictionary slices the form renders — passing the whole Dictionary
 * would serialize ~900 unused keys into the RSC payload.
 */
export interface MorningFormDict {
  morning: Dictionary["morning"];
  common: Dictionary["common"];
  athleteHome: Pick<Dictionary["athleteHome"], "painNotice">;
}

export function MorningForm({
  dict,
  checkinDate,
  existing,
  showSleepHours = false,
  defaultSleepHours,
}: {
  dict: MorningFormDict;
  checkinDate: string;
  existing?: MorningCheckin | null;
  showSleepHours?: boolean;
  defaultSleepHours?: number;
}) {
  const d = dict.morning;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
  } = useForm<FormValues>({
    defaultValues: existing
      ? {
          sleep_score: existing.sleep_score,
          sleep_hours: existing.sleep_hours ?? undefined,
          recovery_score: existing.recovery_score,
          fatigue_score: existing.fatigue_score,
          muscle_soreness_score: existing.muscle_soreness_score,
          stress_score: existing.stress_score,
          mood_score: existing.mood_score,
          pain_status: existing.pain_status,
          pain_location: existing.pain_location ?? "",
          pain_side: existing.pain_side ?? undefined,
          pain_severity: existing.pain_severity ?? undefined,
          pain_onset: existing.pain_onset ?? "",
          pain_triggers: existing.pain_triggers ?? [],
          swelling: existing.swelling ?? false,
          movement_limitation: existing.movement_limitation ?? false,
          symptoms: existing.symptoms ?? "",
          notes: existing.notes ?? "",
        }
      : { pain_status: "none", pain_triggers: [], sleep_hours: defaultSleepHours },
  });

  const painStatus = watch("pain_status");
  const triggers = watch("pain_triggers") ?? [];
  const hasRedFlags =
    painStatus === "acute_instability" || watch("swelling") || watch("movement_limitation");

  async function onSubmit(values: FormValues) {
    const required: (keyof FormValues)[] = [
      "sleep_score",
      "recovery_score",
      "fatigue_score",
      "muscle_soreness_score",
      "stress_score",
      "mood_score",
    ];
    const unfilled = new Set(required.filter((k) => values[k] == null));
    if (unfilled.size > 0) {
      setMissing(unfilled);
      toast.error(dict.common.fillAllScales);
      return;
    }
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      toast.error(dict.common.error);
      return;
    }
    setMissing(new Set());
    setBusy(true);
    try {
      const res = await submitMorningCheckin({
        ...values,
        checkin_date: checkinDate,
        client_uuid: crypto.randomUUID(),
      });
      if (res.ok) {
        toast.success(d.submitted);
        router.push("/athlete");
        router.refresh();
      } else {
        toast.error(dict.common.error);
      }
    } finally {
      setBusy(false);
    }
  }

  const scaleHints = {
    good: dict.common.scaleHintGood,
    mid: dict.common.scaleHintMid,
    bad: dict.common.scaleHintBad,
  };

  const scale = (
    name: keyof FormValues,
    label: string,
    low: string,
    high: string,
    inverted = false,
  ) => (
    <Card
      className={cn(
        "transition-colors",
        missing.has(name) && "border-danger ring-1 ring-danger/50",
      )}
    >
      <CardContent className="pt-4">
        <p className="mb-3 font-medium">{label}</p>
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <ScaleInput
              value={field.value as number | undefined}
              onChange={(v) => {
                field.onChange(v);
                setMissing((s) => {
                  if (!s.has(name)) return s;
                  const next = new Set(s);
                  next.delete(name);
                  return next;
                });
              }}
              lowLabel={low}
              highLabel={high}
              inverted={inverted}
              hints={scaleHints}
            />
          )}
        />
      </CardContent>
    </Card>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {scale("sleep_score", d.sleep, d.sleepLow, d.sleepHigh, false)}
      {showSleepHours && (
        <Card>
          <CardContent className="pt-4">
            <Label htmlFor="sleep_hours">{d.sleepHours}</Label>
            <div className="mt-2 flex items-center gap-2">
              <Input
                id="sleep_hours"
                type="number"
                inputMode="decimal"
                min={0}
                max={16}
                step={0.5}
                className="w-28"
                {...register("sleep_hours", {
                  setValueAs: (v) => (v === "" || v === null || Number.isNaN(+v) ? undefined : +v),
                })}
              />
              <span className="text-sm text-muted">{d.sleepHoursUnit}</span>
            </div>
          </CardContent>
        </Card>
      )}
      {scale("recovery_score", d.recovery, d.recoveryLow, d.recoveryHigh, false)}
      {scale("fatigue_score", d.fatigue, d.fatigueLow, d.fatigueHigh, true)}
      {scale("muscle_soreness_score", d.soreness, d.sorenessLow, d.sorenessHigh, true)}
      {scale("stress_score", d.stress, d.stressLow, d.stressHigh, true)}
      {scale("mood_score", d.mood, d.moodLow, d.moodHigh, false)}

      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 font-medium">{d.painQuestion}</p>
          <div className="grid gap-1.5">
            {painValues.map((v, i) => (
              <button
                key={v}
                type="button"
                onClick={() => setValue("pain_status", v, { shouldDirty: true })}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  painStatus === v
                    ? "border-accent bg-accent/5 font-medium"
                    : "border-border hover:bg-foreground/5",
                )}
              >
                {d[painKeys[i]]}
              </button>
            ))}
          </div>

          {painStatus !== "none" && (
            <div className="mt-4 space-y-4 border-t border-border pt-4">
              <div>
                <Label htmlFor="pain_location">{d.painLocation}</Label>
                <Input
                  id="pain_location"
                  placeholder={d.painLocationPh}
                  {...register("pain_location")}
                />
              </div>
              <div>
                <Label>{d.painSide}</Label>
                <Controller
                  control={control}
                  name="pain_side"
                  render={({ field }) => (
                    <div className="grid grid-cols-4 gap-1.5">
                      {sideValues.map((v, i) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => field.onChange(v)}
                          className={cn(
                            "rounded-lg border px-2 py-2 text-xs",
                            field.value === v
                              ? "border-accent bg-accent/5 font-medium"
                              : "border-border",
                          )}
                        >
                          {d[sideKeys[i]]}
                        </button>
                      ))}
                    </div>
                  )}
                />
              </div>
              <div>
                <Label>{d.painSeverity}</Label>
                <Controller
                  control={control}
                  name="pain_severity"
                  render={({ field }) => (
                    <ScaleInput min={1} max={10} value={field.value} onChange={field.onChange} />
                  )}
                />
              </div>
              <div>
                <Label htmlFor="pain_onset">{d.painOnset}</Label>
                <Input id="pain_onset" placeholder={d.painOnsetPh} {...register("pain_onset")} />
              </div>
              <div>
                <Label>{d.painTriggers}</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {triggerValues.map((v, i) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        setValue(
                          "pain_triggers",
                          triggers.includes(v)
                            ? triggers.filter((x) => x !== v)
                            : [...triggers, v],
                        )
                      }
                      className={cn(
                        "rounded-lg border px-2 py-2 text-xs",
                        triggers.includes(v)
                          ? "border-accent bg-accent/5 font-medium"
                          : "border-border",
                      )}
                    >
                      {d[triggerKeys[i]]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register("swelling")} className="h-4 w-4" />
                {d.swelling}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register("movement_limitation")} className="h-4 w-4" />
                {d.limitation}
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <Label htmlFor="symptoms">{d.symptomsQuestion}</Label>
          <Textarea id="symptoms" placeholder={d.symptomsPh} {...register("symptoms")} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <Label htmlFor="notes">
            {dict.common.comment} <span className="text-muted">({dict.common.optional})</span>
          </Label>
          <Textarea id="notes" placeholder={d.notesPh} {...register("notes")} />
        </CardContent>
      </Card>

      {(hasRedFlags || (watch("symptoms") ?? "").trim().length > 0) && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
          {dict.athleteHome.painNotice}
        </div>
      )}

      {missing.size > 0 && (
        <p className="text-center text-sm font-medium text-danger">
          {dict.common.fillAllScales}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? d.submitting : d.submit}
      </Button>
    </form>
  );
}
