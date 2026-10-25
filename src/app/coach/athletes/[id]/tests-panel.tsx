"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { addTestResult, deleteTestResult } from "@/app/actions/tests";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { SeriesLineChart } from "@/components/charts/series-chart";
import type { FieldTest, FieldTestResult } from "@/lib/types";

type Lang = "ru" | "en" | "ro";

/** Field-test dynamics for one athlete (flag 'field_tests'). */
export function TestsPanel({
  dict,
  lang,
  athleteId,
  tests,
  results,
  groupMedian,
}: {
  dict: Dictionary;
  lang: string;
  athleteId: string;
  tests: FieldTest[];
  results: FieldTestResult[];
  /** test_id -> median of the latest per-athlete best in the same group. */
  groupMedian: Record<string, number>;
}) {
  const d = dict.tests;
  const router = useRouter();
  const [testId, setTestId] = useState<string>(tests[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    test_date: new Date().toISOString().slice(0, 10),
    value: "",
    attempt: "1",
  });

  const test = tests.find((t) => t.id === testId) ?? null;
  const testResults = useMemo(
    () => results.filter((r) => r.test_id === testId),
    [results, testId],
  );

  // Best value per day (by test direction), charted chronologically.
  const series = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of testResults) {
      const prev = byDay.get(r.test_date);
      if (prev === undefined || (test?.higher_better ? r.value > prev : r.value < prev)) {
        byDay.set(r.test_date, r.value);
      }
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
  }, [testResults, test]);

  const best = series.length
    ? test?.higher_better
      ? Math.max(...series.map((s) => s.value))
      : Math.min(...series.map((s) => s.value))
    : null;
  const median = test ? (groupMedian[test.id] ?? null) : null;

  async function save() {
    if (!test || !f.value.trim()) return;
    setBusy(true);
    const res = await addTestResult({
      athlete_id: athleteId,
      test_id: test.id,
      test_date: f.test_date,
      value: Number(f.value),
      attempt: Number(f.attempt) || 1,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(dict.common.saved);
      setF({ ...f, value: "" });
      router.refresh();
    } else toast.error(dict.common.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.panelTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div>
            <Label htmlFor="tp-t">{d.test}</Label>
            <Select id="tp-t" value={testId} onChange={(e) => setTestId(e.target.value)}>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name[lang as Lang] || t.name.en}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tp-d">{d.date}</Label>
            <Input
              id="tp-d"
              type="date"
              value={f.test_date}
              onChange={(e) => setF({ ...f, test_date: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="tp-v">{d.value}{test ? ` (${test.unit})` : ""}</Label>
            <Input
              id="tp-v"
              type="number"
              inputMode="decimal"
              step="any"
              value={f.value}
              onChange={(e) => setF({ ...f, value: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="tp-a">{d.attempt}</Label>
            <Input
              id="tp-a"
              type="number"
              min={1}
              max={9}
              value={f.attempt}
              onChange={(e) => setF({ ...f, attempt: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button size="sm" className="w-full" disabled={busy || !test || !f.value.trim()} onClick={save}>
              {d.add}
            </Button>
          </div>
        </div>

        {series.length > 0 && (
          <>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                {d.best}: <b>{best} {test?.unit}</b>
              </span>
              {median !== null && (
                <span className="text-muted">
                  {d.groupMedian}: <b>{Math.round(median * 10) / 10} {test?.unit}</b>
                </span>
              )}
            </div>
            <SeriesLineChart
              data={series}
              series={[{ key: "value", label: `${test?.name[lang as Lang] || test?.name.en}, ${test?.unit}`, color: "#4c7c0b" }]}
              reference={median !== null ? { y: median, label: d.groupMedian } : undefined}
            />
          </>
        )}

        {testResults.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {testResults
              .slice()
              .sort((a, b) => b.test_date.localeCompare(a.test_date) || b.attempt - a.attempt)
              .slice(0, 8)
              .map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5">
                  <span>
                    {r.test_date} · {d.attempt} {r.attempt}
                  </span>
                  <span className="flex items-center gap-2">
                    <b>{r.value} {test?.unit}</b>
                    <button
                      type="button"
                      className="text-danger/70 hover:text-danger"
                      title={d.del}
                      onClick={async () => {
                        const res = await deleteTestResult(r.id, athleteId);
                        if (res.ok) router.refresh();
                        else toast.error(dict.common.error);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
          </ul>
        )}
        {testResults.length === 0 && <p className="text-sm text-muted">{d.empty}</p>}
      </CardContent>
    </Card>
  );
}
