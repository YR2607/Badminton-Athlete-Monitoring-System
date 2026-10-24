"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { updateAthleteGrowth, addGrowthMeasurement } from "@/app/actions/coach";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { Athlete, GrowthMeasurement } from "@/lib/types";

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function GrowthPanel({
  dict,
  athlete,
  measurements,
  velocity,
  pahCm,
  pctPah,
  category,
}: {
  dict: Dictionary;
  athlete: Athlete;
  measurements: GrowthMeasurement[];
  velocity: number | null;
  pahCm: number | null;
  pctPah: number | null;
  category: "pre_spurt" | "in_spurt" | "post_spurt" | null;
}) {
  const d = dict.growth;
  const router = useRouter();
  const [busy, setBusy] = useState<"bio" | "m" | null>(null);
  const [bio, setBio] = useState({
    birth_date: athlete.birth_date ?? "",
    sex: athlete.sex ?? "",
    mother_height_cm: athlete.mother_height_cm?.toString() ?? "",
    father_height_cm: athlete.father_height_cm?.toString() ?? "",
  });
  const [m, setM] = useState({
    measured_on: new Date().toISOString().slice(0, 10),
    height_cm: "",
    weight_kg: "",
    sitting_height_cm: "",
  });

  async function saveBio() {
    setBusy("bio");
    const res = await updateAthleteGrowth({
      athlete_id: athlete.id,
      birth_date: bio.birth_date,
      sex: bio.sex || undefined,
      mother_height_cm: numOrNull(bio.mother_height_cm),
      father_height_cm: numOrNull(bio.father_height_cm),
    });
    setBusy(null);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else if (res.error === "consent_required") {
      toast.error(d.consentRequired);
    } else toast.error(dict.common.error);
  }

  async function saveMeasurement() {
    setBusy("m");
    const res = await addGrowthMeasurement({
      athlete_id: athlete.id,
      measured_on: m.measured_on,
      height_cm: Number(m.height_cm),
      weight_kg: numOrNull(m.weight_kg),
      sitting_height_cm: numOrNull(m.sitting_height_cm),
    });
    setBusy(null);
    if (res.ok) {
      toast.success(dict.common.saved);
      setM({ ...m, height_cm: "", weight_kg: "", sitting_height_cm: "" });
      router.refresh();
    } else toast.error(dict.common.error);
  }

  const catTone = category === "in_spurt" ? "warn" : category ? "ok" : "neutral";
  const catLabel =
    category === "pre_spurt"
      ? d.catPre
      : category === "in_spurt"
        ? d.catSpurt
        : category === "post_spurt"
          ? d.catPost
          : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* bio / parents */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="bd">{d.birthDate}</Label>
            <Input
              id="bd"
              type="date"
              value={bio.birth_date}
              onChange={(e) => setBio({ ...bio, birth_date: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="sex">{d.sex}</Label>
            <Select
              id="sex"
              value={bio.sex}
              onChange={(e) => setBio({ ...bio, sex: e.target.value as "" | "male" | "female" })}
            >
              <option value="">—</option>
              <option value="male">{d.male}</option>
              <option value="female">{d.female}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="mh">{d.motherHeight}</Label>
            <Input
              id="mh"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={100}
              max={220}
              value={bio.mother_height_cm}
              onChange={(e) => setBio({ ...bio, mother_height_cm: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="fh">{d.fatherHeight}</Label>
            <Input
              id="fh"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={100}
              max={220}
              value={bio.father_height_cm}
              onChange={(e) => setBio({ ...bio, father_height_cm: e.target.value })}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">{d.consentHint}</p>
          <Button size="sm" variant="secondary" disabled={busy === "bio"} onClick={saveBio}>
            {dict.common.save}
          </Button>
        </div>

        {/* computed */}
        {(velocity !== null || pctPah !== null) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-foreground/5 px-3 py-2 text-sm">
            {velocity !== null && (
              <span>
                {d.velocity}: <b>{velocity} {d.cmYear}</b>
              </span>
            )}
            {pahCm !== null && (
              <span>
                {d.pah}: <b>{pahCm} {d.cm}</b>
              </span>
            )}
            {pctPah !== null && (
              <span>
                {d.pctPah}: <b>{pctPah}%</b>
              </span>
            )}
            {catLabel && <Badge tone={catTone}>{catLabel}</Badge>}
          </div>
        )}
        {pahCm === null && measurements.length > 0 && (
          <p className="text-xs text-muted">{d.pahNeedsParents}</p>
        )}

        {/* new measurement */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div>
            <Label htmlFor="md">{d.date}</Label>
            <Input
              id="md"
              type="date"
              value={m.measured_on}
              onChange={(e) => setM({ ...m, measured_on: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="mh2">{d.height}</Label>
            <Input
              id="mh2"
              type="number"
              inputMode="decimal"
              step="0.1"
              required
              value={m.height_cm}
              onChange={(e) => setM({ ...m, height_cm: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="mw">{d.weight}</Label>
            <Input
              id="mw"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={m.weight_kg}
              onChange={(e) => setM({ ...m, weight_kg: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ms">{d.sittingHeight}</Label>
            <Input
              id="ms"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={m.sitting_height_cm}
              onChange={(e) => setM({ ...m, sitting_height_cm: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              className="w-full"
              disabled={busy === "m" || !m.height_cm}
              onClick={saveMeasurement}
            >
              {d.add}
            </Button>
          </div>
        </div>

        {/* history */}
        {measurements.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {measurements
              .slice()
              .sort((a, b) => b.measured_on.localeCompare(a.measured_on))
              .map((g) => (
                <li key={g.id} className="flex justify-between py-1.5">
                  <span>{g.measured_on}</span>
                  <span className="text-muted">
                    {g.height_cm} {d.cm}
                    {g.weight_kg != null && ` · ${g.weight_kg} ${d.kg}`}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
