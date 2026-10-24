"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { submitOstrc } from "@/app/actions/ostrc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OstrcZone } from "@/lib/types";

type Lang = "ru" | "en" | "ro";
type Ans = 0 | 8 | 17 | 25;
const A: Ans = 0;
const D: Ans = 25;

interface ZoneAnswers {
  q1: Ans | null;
  q2: Ans | null;
  q3: Ans | null;
  q4: Ans | null;
  onset_date: string;
  days_missed: string;
  informed: string[];
  other_reason: boolean;
  comment: string;
}

const emptyZone = (): ZoneAnswers => ({
  q1: null, q2: null, q3: null, q4: null,
  onset_date: "", days_missed: "", informed: [], other_reason: false, comment: "",
});

const INFORMED_KEYS = ["coach", "parents", "doctor"] as const;

export function OstrcWizard({
  dict,
  lang,
  zones,
  week,
  done,
}: {
  dict: Dictionary;
  lang: string;
  zones: OstrcZone[];
  week: string;
  done: boolean;
}) {
  const d = dict.ostrc;
  const router = useRouter();
  const [step, setStep] = useState<"intro" | "pick" | "questions" | "sent">(done ? "sent" : "intro");
  const [picked, setPicked] = useState<string[]>([]);
  const [zi, setZi] = useState(0);
  const [answers, setAnswers] = useState<Record<string, ZoneAnswers>>({});
  const [busy, setBusy] = useState(false);

  const zoneName = (z: OstrcZone) => z.name[lang as Lang] || z.name.en || z.code;
  const zoneHint = (z: OstrcZone) => z.hint[lang as Lang] || z.hint.en || "";
  const qText = (key: "q1" | "q2" | "q3" | "q4", z: OstrcZone) =>
    d.questions[key].replace("{zone}", zoneName(z).toLowerCase());

  const pickedZones = zones.filter((z) => picked.includes(z.code));
  const cur = pickedZones[zi];
  const curAnswers = cur ? (answers[cur.code] ?? emptyZone()) : emptyZone();
  const setCur = (patch: Partial<ZoneAnswers>) =>
    cur && setAnswers({ ...answers, [cur.code]: { ...curAnswers, ...patch } });

  async function submit(zoneAnswers: Record<string, ZoneAnswers>, zoneList: OstrcZone[]) {
    setBusy(true);
    const res = await submitOstrc({
      week_start_date: week,
      locale: lang,
      zones: zoneList.map((z) => {
        const a = zoneAnswers[z.code] ?? emptyZone();
        const skipped = a.q1 === A || a.q1 === D;
        return {
          zone_code: z.code,
          q1: a.q1 ?? A,
          q2: skipped ? null : a.q2,
          q3: skipped ? null : a.q3,
          q4: skipped ? null : a.q4,
          onset_date: a.onset_date || null,
          days_missed: a.days_missed === "" ? null : Number(a.days_missed),
          informed: a.informed,
          other_reason: a.other_reason,
          comment: a.comment || null,
        };
      }),
    });
    setBusy(false);
    if (res.ok) {
      setStep("sent");
      router.refresh();
    } else if (res.error === "consent_required") {
      toast.error(d.consentRequired);
    } else {
      toast.error(dict.common.error);
    }
  }

  const allOk = () =>
    submit(
      Object.fromEntries(zones.map((z) => [z.code, { ...emptyZone(), q1: A as Ans }])),
      zones,
    );

  const q1Done = curAnswers.q1 !== null;
  const gateSkipped = curAnswers.q1 === A || curAnswers.q1 === D;
  const q234Done =
    gateSkipped || (curAnswers.q2 !== null && curAnswers.q3 !== null && curAnswers.q4 !== null);
  const canNext = q1Done && q234Done;
  const isLast = zi >= pickedZones.length - 1;

  const options = (key: "q1" | "q2" | "q3" | "q4") =>
    ([A, 8, 17, 25] as Ans[]).map((v, i) => ({
      v,
      label: d.answers[`${key}${"abcd"[i]}` as keyof typeof d.answers],
    }));

  const question = (key: "q2" | "q3" | "q4") => (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{qText(key, cur)}</p>
      <div className="grid gap-1.5">
        {options(key).map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setCur({ [key]: o.v } as Partial<ZoneAnswers>)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left text-sm",
              curAnswers[key] === o.v ? "border-accent bg-accent/10 font-medium" : "border-border",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {step === "sent" ? d.doneTitle : `${d.weekOf} ${week}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "intro" && (
          <>
            <p className="text-sm">{d.intro}</p>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={allOk}>
                {d.allGood}
              </Button>
              <Button className="flex-1" variant="secondary" onClick={() => setStep("pick")}>
                {d.hadIssue}
              </Button>
            </div>
          </>
        )}

        {step === "pick" && (
          <>
            <p className="text-sm">{d.pickZones}</p>
            <div className="flex flex-wrap gap-2">
              {zones.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() =>
                    setPicked(
                      picked.includes(z.code)
                        ? picked.filter((c) => c !== z.code)
                        : [...picked, z.code],
                    )
                  }
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm",
                    picked.includes(z.code) ? "border-accent bg-accent/10 font-medium" : "border-border",
                  )}
                >
                  {zoneName(z)}
                </button>
              ))}
            </div>
            <Button disabled={!picked.length} onClick={() => { setZi(0); setStep("questions"); }}>
              {d.next}
            </Button>
          </>
        )}

        {step === "questions" && cur && (
          <>
            <div className="flex items-center gap-2">
              <Badge tone="accent">{zoneName(cur)}</Badge>
              <span className="text-xs text-muted">
                {zi + 1} / {pickedZones.length}
              </span>
            </div>
            {zoneHint(cur) && <p className="text-xs text-muted">{zoneHint(cur)}</p>}

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{qText("q1", cur)}</p>
              <div className="grid gap-1.5">
                {options("q1").map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() =>
                      setCur({ q1: o.v, ...(o.v === A || o.v === D ? { q2: null, q3: null, q4: null } : {}) })
                    }
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left text-sm",
                      curAnswers.q1 === o.v ? "border-accent bg-accent/10 font-medium" : "border-border",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {!gateSkipped && q1Done && (
              <>
                {question("q2")}
                {question("q3")}
                {question("q4")}

                <div className="space-y-3 border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted">{d.extraTitle}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="o-onset">{d.onset}</Label>
                      <Input
                        id="o-onset"
                        type="date"
                        value={curAnswers.onset_date}
                        onChange={(e) => setCur({ onset_date: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="o-missed">{d.daysMissed}</Label>
                      <Input
                        id="o-missed"
                        type="number"
                        min={0}
                        max={7}
                        value={curAnswers.days_missed}
                        onChange={(e) => setCur({ days_missed: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>{d.informed}</Label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {INFORMED_KEYS.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() =>
                            setCur({
                              informed: curAnswers.informed.includes(k)
                                ? curAnswers.informed.filter((x) => x !== k)
                                : [...curAnswers.informed, k],
                            })
                          }
                          className={cn(
                            "rounded-lg border px-2.5 py-1.5 text-xs",
                            curAnswers.informed.includes(k)
                              ? "border-accent bg-accent/10"
                              : "border-border",
                          )}
                        >
                          {d.informedOpts[k]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={curAnswers.other_reason}
                      onChange={(e) => setCur({ other_reason: e.target.checked })}
                    />
                    {d.otherReason}
                  </label>
                  <Input
                    placeholder={d.commentPh}
                    value={curAnswers.comment}
                    maxLength={2000}
                    onChange={(e) => setCur({ comment: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="flex justify-between gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (zi === 0 ? setStep("pick") : setZi(zi - 1))}
              >
                {d.back}
              </Button>
              <Button
                size="sm"
                disabled={!canNext || busy}
                onClick={() => {
                  if (isLast) void submit(answers, pickedZones);
                  else setZi(zi + 1);
                }}
              >
                {isLast ? d.submit : d.next}
              </Button>
            </div>
          </>
        )}

        {step === "sent" && (
          <p className="text-sm text-ok">{d.doneBody}</p>
        )}
      </CardContent>
    </Card>
  );
}
