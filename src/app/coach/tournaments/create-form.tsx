"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTournamentAction } from "@/app/actions/tournaments";
import type { Dictionary } from "@/i18n";
import type { TournamentFormat } from "@/lib/types";

interface Participant {
  name: string;
  athleteId: string | null;
  partnerAthleteId: string | null;
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
  const [format, setFormat] = useState<TournamentFormat>("singles");
  const [parts, setParts] = useState<Participant[]>(() =>
    Array.from({ length: 8 }, () => ({ name: "", athleteId: null, partnerAthleteId: null })),
  );

  const isPair = format !== "singles";

  const setPart = (idx: number, patch: Partial<Participant>) =>
    setParts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const nameOf = (id: string | null) => athletes.find((a) => a.id === id)?.name ?? "";

  // A pair's label composes itself from both linked athletes; the coach can
  // still type free text for pairs with guest players.
  const pairLabel = (p: Participant) => {
    const n1 = nameOf(p.athleteId);
    const n2 = nameOf(p.partnerAthleteId);
    if (n1 && n2) return `${n1} / ${n2}`;
    return p.name;
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await createTournamentAction({
        title,
        playedOn: date,
        courts,
        format,
        participants: parts.map((p) => ({
          displayName: isPair ? pairLabel(p) : p.name,
          athleteId: p.athleteId,
          partnerAthleteId: isPair ? p.partnerAthleteId : null,
        })),
      });
      if (res.ok) {
        router.push(`/coach/tournaments/${res.id}`);
      } else {
        setError(res.error === "min_players" ? d.errMinPlayers : d.errCreate);
      }
    });
  };

  const athleteSelect = (
    idx: number,
    field: "athleteId" | "partnerAthleteId",
    ph: string,
    linked: string | null,
  ) => (
    <select
      value={linked ?? ""}
      onChange={(e) => {
        const id = e.target.value || null;
        const p = parts[idx];
        const next: Partial<Participant> = { [field]: id };
        // Keep the free-text label in sync while it still looks auto-generated.
        const n1 = field === "athleteId" ? nameOf(id) : nameOf(p.athleteId);
        const n2 = field === "partnerAthleteId" ? nameOf(id) : nameOf(p.partnerAthleteId);
        if (isPair && n1 && n2) next.name = `${n1} / ${n2}`;
        else if (!isPair && !p.name) next.name = nameOf(id);
        setPart(idx, next);
      }}
      title={field === "athleteId" ? d.linkAthlete : d.linkPartner}
      className="w-36 shrink-0 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
    >
      <option value="">{ph}</option>
      {athletes.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

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
        <span className="mb-1 block text-xs text-muted">{d.fieldFormat}</span>
        <div className="flex gap-1.5">
          {(
            [
              ["singles", d.formatSingles],
              ["doubles", d.formatDoubles],
              ["mixed", d.formatMixed],
            ] as [TournamentFormat, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={
                format === f
                  ? "rounded-lg border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
                  : "rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-foreground/5"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs text-muted">
          {isPair ? d.fieldPairs : d.fieldPlayers}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {parts.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-center text-xs text-muted">{i + 1}</span>
              <input
                value={p.name}
                onChange={(e) => setPart(i, { name: e.target.value })}
                placeholder={isPair ? d.pairNamePh : d.playerNamePh}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
              />
              {athleteSelect(i, "athleteId", d.noAthleteLink, p.athleteId)}
              {isPair && athleteSelect(i, "partnerAthleteId", d.noPartnerLink, p.partnerAthleteId)}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setParts((prev) => [...prev, { name: "", athleteId: null, partnerAthleteId: null }])
          }
          className="mt-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium"
        >
          {isPair ? d.addPair : d.addPlayer}
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
