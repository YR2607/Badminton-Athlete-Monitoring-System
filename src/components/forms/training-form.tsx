"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { submitTraining } from "@/app/actions/checkins";
import { ScaleInput } from "@/components/forms/scale-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const schema = z.object({
  started_at: z.string().min(10),
  duration_minutes: z.coerce.number().int().min(1).max(600),
  training_type: z.enum(["court", "technique", "game", "physical", "strength", "recovery", "mixed"]),
  session_rpe: z.number().int().min(0).max(10),
  overall_feeling: z.number().min(1).max(5),
  leg_fatigue: z.number().min(1).max(5),
  arm_shoulder_fatigue: z.number().min(1).max(5),
  pain_status: z.enum(["none", "muscle_soreness", "joint_tendon", "acute_instability", "other"]),
  pain_location: z.string().optional(),
  pain_side: z.enum(["left", "right", "both", "na"]).optional(),
  pain_triggers: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const painKeys = ["painNone", "painMuscle", "painJoint", "painAcute", "painOther"] as const;
const painValues = ["none", "muscle_soreness", "joint_tendon", "acute_instability", "other"] as const;
const sideKeys = ["sideLeft", "sideRight", "sideBoth", "sideNa"] as const;
const sideValues = ["left", "right", "both", "na"] as const;

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TrainingForm({ dict, defaultStartedAt }: { dict: Dictionary; defaultStartedAt?: string }) {
  const d = dict.postTraining;
  const dm = dict.morning;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { control, register, handleSubmit, watch, setValue } = useForm<FormValues>({
    defaultValues: {
      started_at: defaultStartedAt ?? toLocalInput(new Date()),
      pain_status: "none",
      pain_triggers: [],
    },
  });

  const rpe = watch("session_rpe");
  const duration = watch("duration_minutes");
  const painStatus = watch("pain_status");
  const load = (rpe ?? 0) * (duration ?? 0);

  async function onSubmit(values: FormValues) {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      toast.error(dict.common.error);
      return;
    }
    setBusy(true);
    try {
      const res = await submitTraining({
        session: {
          started_at: new Date(values.started_at).toISOString(),
          duration_minutes: values.duration_minutes,
          // training type isn't collected — a single sport context makes the
          // distinction noise; stored as "mixed" for schema compatibility.
          training_type: "mixed",
          session_rpe: values.session_rpe,
          client_uuid: crypto.randomUUID(),
        },
        checkin: {
          overall_feeling: values.overall_feeling,
          leg_fatigue: values.leg_fatigue,
          arm_shoulder_fatigue: values.arm_shoulder_fatigue,
          pain_status: values.pain_status,
          pain_location: values.pain_location,
          pain_side: values.pain_side,
          pain_triggers: values.pain_triggers,
          notes: values.notes,
          client_uuid: crypto.randomUUID(),
        },
      });
      if (res.ok) {
        toast.success(d.checkinSaved);
        router.push("/athlete");
        router.refresh();
      } else {
        toast.error(dict.common.error);
      }
    } finally {
      setBusy(false);
    }
  }

  const scale = (name: keyof FormValues, label: string, low: string, high: string) => (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <ScaleInput value={field.value as number | undefined} onChange={field.onChange} lowLabel={low} highLabel={high} />
        )}
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div>
            <Label htmlFor="started_at">{d.startedAt}</Label>
            <Input id="started_at" type="datetime-local" {...register("started_at")} />
          </div>
          <div>
            <Label htmlFor="duration">{d.duration}</Label>
            <Input id="duration" type="number" inputMode="numeric" min={1} max={600} {...register("duration_minutes")} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{d.rpe}</p>
            <Controller
              control={control}
              name="session_rpe"
              render={({ field }) => (
                <ScaleInput min={0} max={10} value={field.value} onChange={field.onChange} />
              )}
            />
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
              <span>{d.rpeHints.easy}</span>
              <span>{d.rpeHints.moderate}</span>
              <span>{d.rpeHints.hard}</span>
              <span>{d.rpeHints.veryHard}</span>
              <span>{d.rpeHints.max}</span>
            </div>
            {load > 0 && (
              <p className="mt-2 text-sm">
                {d.sessionLoad}: <strong>{load}</strong>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          {scale("overall_feeling", d.overallFeeling, d.feelingLow, d.feelingHigh)}
          {scale("leg_fatigue", d.legFatigue, d.fatigueScaleLow, d.fatigueScaleHigh)}
          {scale("arm_shoulder_fatigue", d.armFatigue, d.fatigueScaleLow, d.fatigueScaleHigh)}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 font-medium">{d.painDuring}</p>
          <div className="grid gap-1.5">
            {painValues.map((v, i) => (
              <button
                key={v}
                type="button"
                onClick={() => setValue("pain_status", v)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm",
                  painStatus === v ? "border-accent bg-accent/5 font-medium" : "border-border hover:bg-foreground/5",
                )}
              >
                {dm[painKeys[i]]}
              </button>
            ))}
          </div>
          {painStatus !== "none" && (
            <div className="mt-4 space-y-4 border-t border-border pt-4">
              <div>
                <Label htmlFor="p_loc">{dm.painLocation}</Label>
                <Input id="p_loc" placeholder={dm.painLocationPh} {...register("pain_location")} />
              </div>
              <div>
                <Label>{dm.painSide}</Label>
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
                            field.value === v ? "border-accent bg-accent/5 font-medium" : "border-border",
                          )}
                        >
                          {dm[sideKeys[i]]}
                        </button>
                      ))}
                    </div>
                  )}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <Label htmlFor="t_notes">
            {dict.common.comment} <span className="text-muted">({dict.common.optional})</span>
          </Label>
          <Textarea id="t_notes" {...register("notes")} />
        </CardContent>
      </Card>

      {painStatus === "acute_instability" && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
          {dict.athleteHome.painNotice}
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? dict.morning.submitting : dict.common.save}
      </Button>
    </form>
  );
}
