"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { saveFieldTest, toggleFieldTest } from "@/app/actions/tests";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { FieldTest } from "@/lib/types";

export function TestsAdmin({ dict, tests }: { dict: Dictionary; tests: FieldTest[] }) {
  const d = dict.tests;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    code: "",
    name_ru: "",
    name_en: "",
    name_ro: "",
    unit: "cm",
    higher_better: true,
  });

  async function save() {
    setBusy(true);
    const res = await saveFieldTest(f);
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      setF({ code: "", name_ru: "", name_en: "", name_ro: "", unit: "cm", higher_better: true });
      router.refresh();
    } else toast.error(dict.common.error);
  }

  async function toggle(t: FieldTest) {
    const res = await toggleFieldTest(t.id, !t.active);
    if (res.ok) router.refresh();
    else toast.error(dict.common.error);
  }

  const name = (t: FieldTest) => t.name.ru || t.name.en || t.code;

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {tests.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name(t)}</p>
              <p className="text-xs text-muted">
                {t.code} · {t.unit} · {t.higher_better ? d.higherBetter : d.lowerBetter}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggle(t)}
              className="shrink-0"
              title={d.toggle}
            >
              <Badge tone={t.active ? "ok" : "neutral"}>{t.active ? d.active : d.inactive}</Badge>
            </button>
          </li>
        ))}
        {tests.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted">{dict.common.noData}</li>
        )}
      </ul>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="ta-code">{d.code}</Label>
              <Input
                id="ta-code"
                value={f.code}
                placeholder="new_test"
                onChange={(e) => setF({ ...f, code: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ta-unit">{d.unit}</Label>
              <Input id="ta-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ta-dir">{d.direction}</Label>
              <Select
                id="ta-dir"
                value={f.higher_better ? "h" : "l"}
                onChange={(e) => setF({ ...f, higher_better: e.target.value === "h" })}
              >
                <option value="h">{d.higherBetter}</option>
                <option value="l">{d.lowerBetter}</option>
              </Select>
            </div>
            {(["ru", "en", "ro"] as const).map((l) => (
              <div key={l}>
                <Label htmlFor={`ta-${l}`}>{d.name} ({l.toUpperCase()})</Label>
                <Input
                  id={`ta-${l}`}
                  value={f[`name_${l}`]}
                  onChange={(e) => setF({ ...f, [`name_${l}`]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <Button
            disabled={busy || !f.code || !f.name_ru || !f.name_en || !f.name_ro || !f.unit}
            onClick={save}
          >
            {d.addTest}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
