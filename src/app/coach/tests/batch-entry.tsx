"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { saveGroupTestResults } from "@/app/actions/tests";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import type { FieldTest } from "@/lib/types";

type Lang = "ru" | "en" | "ro";

export function TestsBatchEntry({
  dict,
  lang,
  tests,
  athletes,
  groups,
}: {
  dict: Dictionary;
  lang: string;
  tests: FieldTest[];
  athletes: { id: string; name: string; groupId: string | null }[];
  groups: { id: string; name: string }[];
}) {
  const d = dict.tests;
  const router = useRouter();
  const [groupId, setGroupId] = useState<string>(groups[0]?.id ?? "all");
  const [testId, setTestId] = useState<string>(tests[0]?.id ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const test = tests.find((t) => t.id === testId) ?? null;
  const rows = athletes.filter((a) => groupId === "all" || a.groupId === groupId);
  const instruction = test?.instruction?.[lang as Lang] || test?.instruction?.en || "";

  async function save() {
    if (!test) return;
    setBusy(true);
    const res = await saveGroupTestResults({
      test_id: test.id,
      test_date: date,
      rows: rows
        .filter((a) => (values[a.id] ?? "").trim() !== "")
        .map((a) => ({ athlete_id: a.id, value: Number(values[a.id]) })),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      setValues({});
      router.refresh();
    } else toast.error(dict.common.error);
  }

  const filled = rows.filter((a) => (values[a.id] ?? "").trim() !== "").length;

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="tb-g">{dict.tests.group}</Label>
            <Select id="tb-g" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="all">{dict.tests.allGroups}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tb-t">{dict.tests.test}</Label>
            <Select id="tb-t" value={testId} onChange={(e) => { setTestId(e.target.value); setValues({}); }}>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name[lang as Lang] || t.name.en}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tb-d">{dict.tests.date}</Label>
            <Input id="tb-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" disabled={busy || !filled || !test} onClick={save}>
              {dict.tests.save} ({filled})
            </Button>
          </div>
        </div>

        {instruction && (
          <p className="rounded-lg bg-foreground/5 px-3 py-2 text-xs text-muted">{instruction}</p>
        )}

        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm">{a.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Input
                  className="w-24 text-right"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={values[a.id] ?? ""}
                  onChange={(e) => setValues({ ...values, [a.id]: e.target.value })}
                />
                <span className="w-8 text-xs text-muted">{test?.unit}</span>
              </span>
            </li>
          ))}
          {rows.length === 0 && <li className="py-3 text-sm text-muted">{dict.common.noData}</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
