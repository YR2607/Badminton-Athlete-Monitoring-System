"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";

export interface NavAthlete {
  id: string;
  name: string;
}

export function AthleteSwitcher({
  athletes,
  currentId,
  label,
}: {
  athletes: NavAthlete[];
  currentId: string;
  label: string;
}) {
  const router = useRouter();
  const idx = athletes.findIndex((a) => a.id === currentId);
  const prev = idx > 0 ? athletes[idx - 1] : null;
  const next = idx >= 0 && idx < athletes.length - 1 ? athletes[idx + 1] : null;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="‹"
        disabled={!prev}
        onClick={() => prev && router.push(`/coach/athletes/${prev.id}`)}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/5 text-lg disabled:opacity-30"
      >
        ‹
      </button>
      <Select
        aria-label={label}
        className="w-44"
        value={currentId}
        onChange={(e) => router.push(`/coach/athletes/${e.target.value}`)}
      >
        {athletes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <button
        type="button"
        aria-label="›"
        disabled={!next}
        onClick={() => next && router.push(`/coach/athletes/${next.id}`)}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/5 text-lg disabled:opacity-30"
      >
        ›
      </button>
    </div>
  );
}
