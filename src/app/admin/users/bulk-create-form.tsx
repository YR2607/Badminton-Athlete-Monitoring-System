"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import {
  adminBulkCreateAthletes,
  type BulkCreateResult,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/input";

export function BulkCreateForm({
  dict,
  groups,
}: {
  dict: Dictionary;
  groups: { id: string; name: string }[];
}) {
  const d = dict.admin;
  const router = useRouter();
  const [names, setNames] = useState("");
  const [groupId, setGroupId] = useState("");
  const [lang, setLang] = useState("ru");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkCreateResult[] | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    if (busy || !names.trim()) return;
    setBusy(true);
    const res = await adminBulkCreateAthletes({
      names: names.split("\n"),
      group_id: groupId || undefined,
      preferred_language: lang,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? dict.common.error);
      return;
    }
    setResults(res.results ?? []);
    const created = (res.results ?? []).filter((r) => !r.error).length;
    toast.success(d.bulkDone.replace("{n}", String(created)));
    router.refresh();
  }

  async function copyAll() {
    try {
      const text = (results ?? [])
        .filter((r) => !r.error)
        .map((r) => `${r.name}\t${r.login}\t${r.password}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(dict.common.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{d.bulkTitle}</CardTitle>
        <p className="text-xs text-muted">{d.bulkHint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>{d.bulkNamesLabel}</Label>
          <Textarea
            rows={6}
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder={d.bulkNamesPh}
            className="font-mono text-sm"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{dict.common.group}</Label>
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{d.lang}</Label>
            <Select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
              <option value="ro">Română</option>
            </Select>
          </div>
        </div>
        <Button disabled={busy || !names.trim()} onClick={() => void submit()}>
          {d.bulkBtn}
        </Button>

        {results && (
          <div className="space-y-2 rounded-xl border border-ok/40 bg-ok/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{d.bulkResults}</p>
              <Button size="sm" variant="secondary" onClick={copyAll}>
                {copied ? d.copied : d.copyAll}
              </Button>
            </div>
            <ul className="divide-y divide-border/60 font-mono text-xs">
              {results.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 py-1.5">
                  <span className="w-40 truncate font-sans font-medium">{r.name}</span>
                  {r.error ? (
                    <span className="text-danger">⚠ {r.error}</span>
                  ) : (
                    <>
                      <span>
                        {d.login}: <b>{r.login}</b>
                      </span>
                      <span>
                        {dict.auth.password}: <b>{r.password}</b>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
