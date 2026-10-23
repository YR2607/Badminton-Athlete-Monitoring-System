"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import {
  coachUpsertMorningCheckin,
  coachUpsertPostCheckin,
} from "@/app/actions/coach";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ScaleInput } from "@/components/forms/scale-input";
import type {
  MorningCheckin,
  PainStatus,
  PostTrainingCheckin,
} from "@/lib/types";

const PAIN_OPTIONS: PainStatus[] = [
  "none",
  "muscle_soreness",
  "joint_tendon",
  "acute_instability",
  "other",
];
const TRIGGER_KEYS = ["triggerWalking", "triggerJumping", "triggerLunges", "triggerRest"] as const;
const TRIGGER_VALUES = ["walking", "jumping", "lunges", "rest"] as const;

function painOptionLabel(dict: Dictionary, s: PainStatus): string {
  const m = dict.morning;
  return {
    none: m.painNone,
    muscle_soreness: m.painMuscle,
    joint_tendon: m.painJoint,
    acute_instability: m.painAcute,
    other: m.painOther,
  }[s];
}

function PainExtras({
  dict,
  painStatus,
  location,
  setLocation,
  severity,
  setSeverity,
  showSeverity,
}: {
  dict: Dictionary;
  painStatus: PainStatus;
  location: string;
  setLocation: (v: string) => void;
  severity: string;
  setSeverity: (v: string) => void;
  showSeverity: boolean;
}) {
  if (painStatus === "none") return null;
  const m = dict.morning;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <Label>{m.painLocation}</Label>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={m.painLocationPh} />
      </div>
      {showSeverity && (
        <div>
          <Label>{m.painSeverity}</Label>
          <Input
            type="number"
            min={1}
            max={10}
            inputMode="numeric"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function TriggerBoxes({
  dict,
  values,
  toggle,
}: {
  dict: Dictionary;
  values: string[];
  toggle: (v: string) => void;
}) {
  const m = dict.morning;
  return (
    <div className="flex flex-wrap gap-2">
      {TRIGGER_VALUES.map((v, i) => (
        <label key={v} className="flex items-center gap-1.5 rounded-lg bg-foreground/5 px-3 py-2 text-sm">
          <input type="checkbox" checked={values.includes(v)} onChange={() => toggle(v)} />
          {m[TRIGGER_KEYS[i]]}
        </label>
      ))}
    </div>
  );
}

/** Coach edits / fills the morning check-in for a given day. */
export function CheckinEditor({
  dict,
  athleteId,
  date,
  checkin,
}: {
  dict: Dictionary;
  athleteId: string;
  date: string;
  checkin: MorningCheckin | null;
}) {
  const d = dict.day;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    sleep: checkin?.sleep_score,
    recovery: checkin?.recovery_score,
    fatigue: checkin?.fatigue_score,
    soreness: checkin?.muscle_soreness_score,
    stress: checkin?.stress_score,
    mood: checkin?.mood_score,
    painStatus: (checkin?.pain_status ?? "none") as PainStatus,
    painLocation: checkin?.pain_location ?? "",
    painSide: checkin?.pain_side ?? "na",
    painSeverity: checkin?.pain_severity?.toString() ?? "",
    painOnset: checkin?.pain_onset ?? "",
    triggers: checkin?.pain_triggers ?? [],
    swelling: checkin?.swelling ?? false,
    limitation: checkin?.movement_limitation ?? false,
    symptoms: checkin?.symptoms ?? "",
    notes: checkin?.notes ?? "",
  });

  const scales: [keyof typeof f, string][] = [
    ["sleep", dict.morning.sleep],
    ["recovery", dict.morning.recovery],
    ["fatigue", dict.morning.fatigue],
    ["soreness", dict.morning.soreness],
    ["stress", dict.morning.stress],
    ["mood", dict.morning.mood],
  ];

  const toggleTrigger = (v: string) =>
    setF((s) => ({
      ...s,
      triggers: s.triggers.includes(v) ? s.triggers.filter((t) => t !== v) : [...s.triggers, v],
    }));

  async function save() {
    if ([f.sleep, f.recovery, f.fatigue, f.soreness, f.stress, f.mood].some((v) => v === undefined)) {
      toast.error(dict.common.error);
      return;
    }
    setBusy(true);
    const res = await coachUpsertMorningCheckin({
      athlete_id: athleteId,
      checkin_date: date,
      sleep_score: f.sleep!,
      recovery_score: f.recovery!,
      fatigue_score: f.fatigue!,
      muscle_soreness_score: f.soreness!,
      stress_score: f.stress!,
      mood_score: f.mood!,
      pain_status: f.painStatus,
      pain_location: f.painLocation || null,
      pain_side: f.painStatus === "none" ? null : f.painSide,
      pain_severity: f.painSeverity ? Number(f.painSeverity) : null,
      pain_onset: f.painOnset || null,
      pain_triggers: f.painStatus === "none" ? [] : f.triggers,
      swelling: f.painStatus === "none" ? null : f.swelling,
      movement_limitation: f.painStatus === "none" ? null : f.limitation,
      symptoms: f.symptoms || null,
      notes: f.notes || null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
        {checkin ? d.editCheckin : d.fillCheckin}
      </Button>
    );
  }

  const m = dict.morning;
  return (
    <div className="mt-3 space-y-4 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold">{checkin ? d.editCheckin : d.fillCheckin}</p>
      {scales.map(([key, label]) => (
        <div key={key}>
          <p className="mb-1 text-sm">{label}</p>
          <ScaleInput
            value={f[key] as number | undefined}
            onChange={(v) => setF((s) => ({ ...s, [key]: v }))}
          />
        </div>
      ))}

      <div>
        <p className="mb-1 text-sm">{m.painQuestion}</p>
        <Select value={f.painStatus} onChange={(e) => setF((s) => ({ ...s, painStatus: e.target.value as PainStatus }))}>
          {PAIN_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {painOptionLabel(dict, o)}
            </option>
          ))}
        </Select>
      </div>
      {f.painStatus !== "none" && (
        <>
          <PainExtras
            dict={dict}
            painStatus={f.painStatus}
            location={f.painLocation}
            setLocation={(v) => setF((s) => ({ ...s, painLocation: v }))}
            severity={f.painSeverity}
            setSeverity={(v) => setF((s) => ({ ...s, painSeverity: v }))}
            showSeverity
          />
          <div>
            <Label>{m.painSide}</Label>
            <div className="flex gap-2">
              {(["left", "right", "both", "na"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setF((s) => ({ ...s, painSide: v }))}
                  className={`rounded-lg px-3 py-2 text-sm ${f.painSide === v ? "bg-accent text-white" : "bg-foreground/5"}`}
                >
                  {{ left: m.sideLeft, right: m.sideRight, both: m.sideBoth, na: m.sideNa }[v]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>{dict.day.triggers}</Label>
            <TriggerBoxes dict={dict} values={f.triggers} toggle={toggleTrigger} />
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1.5 rounded-lg bg-foreground/5 px-3 py-2 text-sm">
              <input type="checkbox" checked={f.swelling} onChange={(e) => setF((s) => ({ ...s, swelling: e.target.checked }))} />
              {m.swelling}
            </label>
            <label className="flex items-center gap-1.5 rounded-lg bg-foreground/5 px-3 py-2 text-sm">
              <input type="checkbox" checked={f.limitation} onChange={(e) => setF((s) => ({ ...s, limitation: e.target.checked }))} />
              {m.limitation}
            </label>
          </div>
          <div>
            <Label>{dict.day.onset}</Label>
            <Input value={f.painOnset} onChange={(e) => setF((s) => ({ ...s, painOnset: e.target.value }))} placeholder={m.painOnsetPh} />
          </div>
        </>
      )}

      <div>
        <Label>{dict.day.symptoms}</Label>
        <Input value={f.symptoms} onChange={(e) => setF((s) => ({ ...s, symptoms: e.target.value }))} placeholder={m.symptomsPh} />
      </div>
      <div>
        <Label>{dict.day.notes}</Label>
        <Textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          {dict.common.save}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {dict.common.cancel}
        </Button>
      </div>
    </div>
  );
}

/** Coach edits / fills the post-training check-in of a session. When the day
 * has no session yet, saving creates the session marker automatically. */
export function PostCheckinEditor({
  dict,
  athleteId,
  sessionId,
  date,
  post,
}: {
  dict: Dictionary;
  athleteId: string;
  sessionId: string | null;
  date: string;
  post: PostTrainingCheckin | null;
}) {
  const d = dict.day;
  const pt = dict.postTraining;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    feeling: post?.overall_feeling,
    legs: post?.leg_fatigue,
    arms: post?.arm_shoulder_fatigue,
    painStatus: (post?.pain_status ?? "none") as PainStatus,
    painLocation: post?.pain_location ?? "",
    triggers: post?.pain_triggers ?? [],
    notes: post?.notes ?? "",
  });

  async function save() {
    if ([f.feeling, f.legs, f.arms].some((v) => v === undefined)) {
      toast.error(dict.common.error);
      return;
    }
    setBusy(true);
    const res = await coachUpsertPostCheckin({
      training_session_id: sessionId,
      session_date: date,
      athlete_id: athleteId,
      overall_feeling: f.feeling!,
      leg_fatigue: f.legs!,
      arm_shoulder_fatigue: f.arms!,
      pain_status: f.painStatus,
      pain_location: f.painLocation || null,
      pain_triggers: f.painStatus === "none" ? [] : f.triggers,
      notes: f.notes || null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(res.error ?? dict.common.error);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setOpen(true)}>
        {post ? d.editPost : d.fillPost}
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold">{post ? d.editPost : d.fillPost}</p>
      <div>
        <p className="mb-1 text-sm">{pt.overallFeeling}</p>
        <ScaleInput value={f.feeling} onChange={(v) => setF((s) => ({ ...s, feeling: v }))} />
      </div>
      <div>
        <p className="mb-1 text-sm">{pt.legFatigue}</p>
        <ScaleInput value={f.legs} onChange={(v) => setF((s) => ({ ...s, legs: v }))} />
      </div>
      <div>
        <p className="mb-1 text-sm">{pt.armFatigue}</p>
        <ScaleInput value={f.arms} onChange={(v) => setF((s) => ({ ...s, arms: v }))} />
      </div>
      <div>
        <Label>{dict.day.pain}</Label>
        <Select value={f.painStatus} onChange={(e) => setF((s) => ({ ...s, painStatus: e.target.value as PainStatus }))}>
          {PAIN_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {painOptionLabel(dict, o)}
            </option>
          ))}
        </Select>
      </div>
      {f.painStatus !== "none" && (
        <>
          <PainExtras
            dict={dict}
            painStatus={f.painStatus}
            location={f.painLocation}
            setLocation={(v) => setF((s) => ({ ...s, painLocation: v }))}
            severity=""
            setSeverity={() => {}}
            showSeverity={false}
          />
          <div>
            <Label>{dict.day.triggers}</Label>
            <TriggerBoxes dict={dict} values={f.triggers} toggle={(v) =>
              setF((s) => ({
                ...s,
                triggers: s.triggers.includes(v) ? s.triggers.filter((t) => t !== v) : [...s.triggers, v],
              }))
            } />
          </div>
        </>
      )}
      <div>
        <Label>{dict.day.notes}</Label>
        <Textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          {dict.common.save}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {dict.common.cancel}
        </Button>
      </div>
    </div>
  );
}
