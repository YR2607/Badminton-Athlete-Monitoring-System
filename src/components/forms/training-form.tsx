"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { submitEveningCheckin } from "@/app/actions/checkins";
import { ScaleInput } from "@/components/forms/scale-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const schema = z.object({
  overall_feeling: z.number().min(1).max(10),
  leg_fatigue: z.number().min(1).max(10),
  arm_shoulder_fatigue: z.number().min(1).max(10),
  session_rpe: z.number().int().min(0).max(10).optional(),
  session_minutes: z.number().int().min(1).max(600).optional(),
  session_day: z.enum(["today", "yesterday"]).default("today"),
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

export function TrainingForm({
  dict,
  srpe,
  defaultMinutes,
  allowYesterday,
}: {
  dict: Dictionary;
  /** sRPE feature flag: show RPE + minutes fields */
  srpe: boolean;
  /** Prefill from the group schedule */
  defaultMinutes?: number;
  /** Yesterday was a scheduled training day → allow backfilling it */
  allowYesterday?: boolean;
}) {
  const d = dict.postTraining;
  const dm = dict.morning;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const { control, register, handleSubmit, watch, setValue } = useForm<FormValues>({
    defaultValues: {
      pain_status: "none",
      pain_triggers: [],
      session_day: "today",
      session_minutes: defaultMinutes,
    },
  });

  const painStatus = watch("pain_status");
  const sessionDay = watch("session_day");
  const rpe = watch("session_rpe");

  async function onSubmit(values: FormValues) {
    const required: (keyof FormValues)[] = [
      "overall_feeling",
      "leg_fatigue",
      "arm_shoulder_fatigue",
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
      const res = await submitEveningCheckin({
        overall_feeling: values.overall_feeling,
        leg_fatigue: values.leg_fatigue,
        arm_shoulder_fatigue: values.arm_shoulder_fatigue,
        session_rpe: srpe ? values.session_rpe : undefined,
        session_minutes: srpe ? values.session_minutes : undefined,
        session_day: srpe ? values.session_day : "today",
        pain_status: values.pain_status,
        pain_location: values.pain_location,
        pain_side: values.pain_side,
        pain_triggers: values.pain_triggers,
        notes: values.notes,
        client_uuid: crypto.randomUUID(),
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
    <div
      className={cn(
        "-mx-2 rounded-lg px-2 py-1 transition-colors",
        missing.has(name) && "bg-danger/10 ring-1 ring-danger/50",
      )}
    >
      <p className="mb-2 text-sm font-medium">{label}</p>
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
          />
        )}
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {srpe && (
        <Card>
          <CardContent className="space-y-4 pt-4">
            {allowYesterday && (
              <div>
                <p className="mb-2 text-sm font-medium">{d.when}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["today", "yesterday"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setValue("session_day", v)}
                      className={cn(
                        "min-h-11 rounded-lg border text-sm font-medium",
                        sessionDay === v
                          ? "border-accent bg-accent/10"
                          : "border-border hover:bg-foreground/5",
                      )}
                    >
                      {v === "today" ? d.today : d.yesterday}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-medium">{d.rpe}</p>
              <Controller
                control={control}
                name="session_rpe"
                render={({ field }) => (
                  <ScaleInput
                    min={0}
                    max={10}
                    value={field.value}
                    onChange={field.onChange}
                    lowLabel={d.rpeAnchors["0"]}
                    highLabel={d.rpeAnchors["10"]}
                  />
                )}
              />
              {rpe != null && d.rpeAnchors[String(rpe) as keyof typeof d.rpeAnchors] && (
                <p className="mt-1 text-center text-xs text-muted">
                  {rpe} — {d.rpeAnchors[String(rpe) as keyof typeof d.rpeAnchors]}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="s_min">{d.minutes}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="s_min"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  className="w-28"
                  {...register("session_minutes", {
                    setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                  })}
                />
                <span className="text-sm text-muted">{d.minutesUnit}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                  painStatus === v ? "border-accent bg-accent/10 font-medium" : "border-border hover:bg-foreground/5",
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
                            field.value === v ? "border-accent bg-accent/10 font-medium" : "border-border",
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

      {missing.size > 0 && (
        <p className="text-center text-sm font-medium text-danger">
          {dict.common.fillAllScales}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? dict.morning.submitting : dict.common.save}
      </Button>
    </form>
  );
}
