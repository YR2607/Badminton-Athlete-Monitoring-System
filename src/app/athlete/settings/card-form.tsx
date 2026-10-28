"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { updateOwnAthleteCard } from "@/app/actions/settings";
import {
  AVATAR_PRESETS,
  avatarPublicUrl,
  getAvatarPreset,
  presetSvgDataUrl,
  type AvatarPreset,
} from "@/lib/avatars";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Athlete, Locale } from "@/lib/types";

const DISCIPLINES = ["MS", "WS", "MD", "WD", "XD"];
const STYLES = ["attacking", "defensive", "net", "allround"] as const;
const STYLE_LABEL: Record<(typeof STYLES)[number], keyof Dictionary["card"]> = {
  attacking: "styleAttacking",
  defensive: "styleDefensive",
  net: "styleNet",
  allround: "styleAllround",
};

export function AthleteCardForm({
  dict,
  lang,
  athlete,
  takenAvatars,
}: {
  dict: Dictionary;
  lang: Locale;
  athlete: Athlete;
  takenAvatars: string[];
}) {
  const router = useRouter();
  const c = dict.card;
  const [busy, setBusy] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(!athlete.photo_path);
  const [photo, setPhoto] = useState(athlete.photo_path ?? null);

  const takenSet = new Set(takenAvatars);
  const currentPreset = getAvatarPreset(photo);

  // Hide avatars already claimed by other athletes; keep the athlete's own selection visible.
  const available = AVATAR_PRESETS.filter(
    (p) => p.id === photo || !takenSet.has(p.id),
  );
  const legends = available.filter((p) => p.category === "legend");
  const totems = available.filter((p) => p.category === "totem");

  async function pickAvatar(nextId: string | null) {
    if (savingAvatar) return;
    setSavingAvatar(nextId ?? "__clear__");
    const res = await updateOwnAthleteCard({ photo_path: nextId });
    setSavingAvatar(null);
    if (res.ok) {
      setPhoto(nextId);
      toast.success(dict.common.saved);
      router.refresh();
    } else if (res.error === "avatar_taken") {
      toast.error(c.avatarTaken);
      router.refresh();
    } else {
      toast.error(dict.common.error);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const res = await updateOwnAthleteCard({
      preferred_discipline: String(fd.get("preferred_discipline") ?? "") || null,
      play_style: String(fd.get("play_style") ?? "") || null,
      season_goal: String(fd.get("season_goal") ?? ""),
      racket_model: String(fd.get("racket_model") ?? ""),
      string_tension_kg: fd.get("string_tension_kg")
        ? Number(fd.get("string_tension_kg"))
        : null,
      restrung_on: String(fd.get("restrung_on") ?? "") || null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(dict.common.error);
    }
  }

  function renderGrid(items: AvatarPreset[]) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((p) => {
          const active = photo === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={savingAvatar !== null}
              onClick={() => void pickAvatar(active ? null : p.id)}
              title={`${p.title[lang]} — ${p.subtitle[lang]}`}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all",
                active
                  ? "border-accent bg-accent/10 ring-2 ring-accent/40"
                  : "border-border bg-surface hover:border-accent/40",
                savingAvatar === p.id && "animate-pulse",
              )}
            >
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-border bg-foreground/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarPublicUrl(p.id)}
                  alt={p.title[lang]}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = presetSvgDataUrl(p);
                  }}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold leading-tight">
                  {p.emoji} {p.title[lang]}
                </p>
                <p className="truncate text-[10px] text-muted leading-tight">
                  {p.subtitle[lang]}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{c.title}</CardTitle>
        <p className="text-xs text-muted">{c.hint}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border/70 bg-foreground/[0.02] p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-foreground/5 text-2xl">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarPublicUrl(photo)}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      if (currentPreset) {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = presetSvgDataUrl(currentPreset);
                      }
                    }}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  "🏸"
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{c.avatarTitle}</p>
                {currentPreset ? (
                  <p className="truncate text-sm font-medium">
                    {currentPreset.emoji} {currentPreset.title[lang]}
                    <span className="block truncate text-xs font-normal text-muted">
                      {currentPreset.subtitle[lang]}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-muted">{c.avatarHint}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setPickerOpen((v) => !v)}
                  >
                    {pickerOpen ? c.avatarHide : c.avatarChange}
                  </Button>
                  {photo && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={savingAvatar !== null}
                      onClick={() => void pickAvatar(null)}
                    >
                      {c.avatarClear}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {pickerOpen && (
              <div className="space-y-3 pt-1">
                <p className="text-[11px] text-muted">{c.avatarHint}</p>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">
                    ⭐ {c.avatarLegends} ({legends.length})
                  </p>
                  {renderGrid(legends)}
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">
                    🏸 {c.avatarTotems} ({totems.length})
                  </p>
                  {renderGrid(totems)}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{c.discipline}</Label>
              <Select name="preferred_discipline" defaultValue={athlete.preferred_discipline ?? ""}>
                <option value="">{c.none}</option>
                {DISCIPLINES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{c.style}</Label>
              <Select name="play_style" defaultValue={athlete.play_style ?? ""}>
                <option value="">{c.none}</option>
                {STYLES.map((s) => (
                  <option key={s} value={s}>
                    {c[STYLE_LABEL[s]]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label>{c.goal}</Label>
            <Input
              name="season_goal"
              defaultValue={athlete.season_goal ?? ""}
              placeholder={c.goalPh}
              maxLength={200}
            />
          </div>

          <div>
            <Label>{c.racket}</Label>
            <Input
              name="racket_model"
              defaultValue={athlete.racket_model ?? ""}
              placeholder={c.racketPh}
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{c.tension}</Label>
              <Input
                name="string_tension_kg"
                type="number"
                step="0.5"
                min={8}
                max={20}
                defaultValue={athlete.string_tension_kg ?? ""}
              />
            </div>
            <div>
              <Label>{c.restrungOn}</Label>
              <Input name="restrung_on" type="date" defaultValue={athlete.restrung_on ?? ""} />
            </div>
          </div>

          <Button type="submit" disabled={busy} className="w-full">
            {dict.common.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
