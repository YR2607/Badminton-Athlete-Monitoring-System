"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTournamentAction } from "@/app/actions/tournaments";
import type { Dictionary } from "@/i18n";

interface Participant {
  name: string;
  athleteId: string | null;
}

export function TournamentCreateForm({
  d,
  athletes,
  today,
}: {
  d: Dictionary["tournaments"];
  athletes: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [courts, setCourts] = useState(4);
  const [parts, setParts] = useState<Participant[]>(() =>
    Array.from({ length: 8 }, () => ({ name: "", athleteId: null })),
  );

  const setPart = (idx: number, patch: Partial<Participant>) =>
    setParts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await createTournamentAction({
        title,
        playedOn: date,
        courts,
        participants: parts.map((p) => ({ displayName: p.name, athleteId: p.athleteId })),
      });
      if (res.ok) {
        router.push(`/coach/tournaments/${res.id}`);
      } else {
        setError(res.error === "min_players" ? d.errMinPlayers : d.errCreate);
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{d.fieldName}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={d.fieldNamePh}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{d.fieldDate}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{d.fieldCourts}</span>
          <input
            type="number"
            min={1}
            max={12}
            value={courts}
            onChange={(e) => setCourts(Number(e.target.value) || 4)}
            className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div>
        <div className="mb-1 text-xs text-muted">{d.fieldPlayers}</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {parts.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-center text-xs text-muted">{i + 1}</span>
              <input
                value={p.name}
                onChange={(e) => setPart(i, { name: e.target.value })}
                placeholder={d.playerNamePh}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
              />
              <select
                value={p.athleteId ?? ""}
                onChange={(e) => {
                  const athleteId = e.target.value || null;
                  const a = athletes.find((x) => x.id === athleteId);
                  setPart(i, {
                    athleteId,
                    name: p.name || a?.name || "",
                  });
                }}
                title={d.linkAthlete}
                className="w-36 shrink-0 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
              >
                <option value="">{d.noAthleteLink}</option>
                {athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setParts((prev) => [...prev, { name: "", athleteId: null }])}
          className="mt-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium"
        >
          {d.addPlayer}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {busy ? d.creating : d.createBtn}
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
