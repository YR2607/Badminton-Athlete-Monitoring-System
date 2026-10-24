"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { saveOstrcZone, toggleOstrcZone } from "@/app/actions/ostrc-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { OstrcZone } from "@/lib/types";

export function OstrcZonesAdmin({ dict, zones }: { dict: Dictionary; zones: OstrcZone[] }) {
  const d = dict.tests;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ code: "", ru: "", en: "", ro: "", hint_ru: "", hint_en: "", hint_ro: "" });

  async function save() {
    setBusy(true);
    const res = await saveOstrcZone(f);
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      setF({ code: "", ru: "", en: "", ro: "", hint_ru: "", hint_en: "", hint_ro: "" });
      router.refresh();
    } else toast.error(dict.common.error);
  }

  async function toggle(z: OstrcZone) {
    const res = await toggleOstrcZone(z.id, !z.active);
    if (res.ok) router.refresh();
    else toast.error(dict.common.error);
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {zones.map((z) => (
          <li key={z.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{z.name.ru || z.name.en || z.code}</p>
              <p className="text-xs text-muted">{z.code}</p>
            </div>
            <button type="button" onClick={() => toggle(z)} className="shrink-0" title={d.toggle}>
              <Badge tone={z.active ? "ok" : "neutral"}>{z.active ? d.active : d.inactive}</Badge>
            </button>
          </li>
        ))}
      </ul>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="oz-code">{d.code}</Label>
              <Input id="oz-code" value={f.code} placeholder="hip" onChange={(e) => setF({ ...f, code: e.target.value })} />
            </div>
            {(["ru", "en", "ro"] as const).map((l) => (
              <div key={l}>
                <Label htmlFor={`oz-${l}`}>{d.name} ({l.toUpperCase()})</Label>
                <Input id={`oz-${l}`} value={f[l]} onChange={(e) => setF({ ...f, [l]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="grid gap-3">
            {(["ru", "en", "ro"] as const).map((l) => (
              <div key={l}>
                <Label htmlFor={`ozh-${l}`}>{d.hintLabel} ({l.toUpperCase()})</Label>
                <Input
                  id={`ozh-${l}`}
                  value={f[`hint_${l}`]}
                  onChange={(e) => setF({ ...f, [`hint_${l}`]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <Button disabled={busy || !f.code || !f.ru || !f.en || !f.ro} onClick={save}>
            {d.addZone}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
