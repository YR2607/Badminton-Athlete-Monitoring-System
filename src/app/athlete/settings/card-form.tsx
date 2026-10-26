"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { updateOwnAthleteCard } from "@/app/actions/settings";
import { avatarPublicUrl } from "@/lib/avatars";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Athlete } from "@/lib/types";

const DISCIPLINES = ["MS", "WS", "MD", "WD", "XD"];
const STYLES = ["attacking", "defensive", "net", "allround"] as const;
const STYLE_LABEL: Record<(typeof STYLES)[number], keyof Dictionary["card"]> = {
  attacking: "styleAttacking",
  defensive: "styleDefensive",
  net: "styleNet",
  allround: "styleAllround",
};

export function AthleteCardForm({ dict, athlete }: { dict: Dictionary; athlete: Athlete }) {
  const router = useRouter();
  const c = dict.card;
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState(athlete.photo_path ?? null);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error(c.photoNotImage);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(c.photoTooBig);
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const path = `${athlete.id}/avatar.jpg`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, cacheControl: "300", contentType: file.type });
    if (error) {
      setUploading(false);
      toast.error(dict.common.error);
      return;
    }
    const res = await updateOwnAthleteCard({ photo_path: path });
    setUploading(false);
    if (res.ok) {
      setPhoto(path);
      toast.success(dict.common.saved);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{c.title}</CardTitle>
        <p className="text-xs text-muted">{c.hint}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-foreground/5 text-2xl",
              )}
            >
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarPublicUrl(photo)} alt="" className="h-full w-full object-cover" />
              ) : (
                "🏸"
              )}
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "…" : c.photoUpload}
              </Button>
            </div>
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
