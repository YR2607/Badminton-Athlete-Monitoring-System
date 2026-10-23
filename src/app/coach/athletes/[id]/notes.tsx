"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Dictionary } from "@/i18n";
import { addCoachNote } from "@/app/actions/coach";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import type { CoachNote } from "@/lib/types";

export function CoachNotes({
  athleteId,
  notes,
  dict,
}: {
  athleteId: string;
  notes: CoachNote[];
  dict: Dictionary;
}) {
  const dd = dict.athleteDetail;
  const router = useRouter();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"note" | "decision">("note");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    const res = await addCoachNote({ athlete_id: athleteId, kind, note: text.trim() });
    setBusy(false);
    if (res.ok) {
      setText("");
      toast.success(dict.common.saved);
      router.refresh();
    } else {
      toast.error(dict.common.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dd.notes}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-border text-sm">
          {notes.map((n) => (
            <li key={n.id} className="py-2">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>{n.created_at.slice(0, 16).replace("T", " ")}</span>
                {n.kind === "decision" && <Badge tone="accent">{dd.decisions}</Badge>}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap">{n.note}</p>
            </li>
          ))}
          {notes.length === 0 && <li className="py-2 text-muted">{dict.common.noData}</li>}
        </ul>
        <div className="flex gap-2">
          <Button
            variant={kind === "note" ? "default" : "secondary"}
            size="sm"
            onClick={() => setKind("note")}
          >
            {dd.addNote}
          </Button>
          <Button
            variant={kind === "decision" ? "default" : "secondary"}
            size="sm"
            onClick={() => setKind("decision")}
          >
            {dd.addDecision}
          </Button>
        </div>
        <Textarea
          placeholder={dd.notePh}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button onClick={submit} disabled={busy || !text.trim()}>
          {dict.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}
