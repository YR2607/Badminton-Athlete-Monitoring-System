"use client";

import Link from "next/link";
import type { Dictionary } from "@/i18n";
import type { PainSide } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BodyZoneKey =
  | "shoulder"
  | "elbow"
  | "wrist"
  | "back"
  | "hip"
  | "knee"
  | "shin"
  | "achilles"
  | "ankle";

export const BODY_ZONE_KEYS: BodyZoneKey[] = [
  "shoulder",
  "elbow",
  "wrist",
  "back",
  "hip",
  "knee",
  "shin",
  "achilles",
  "ankle",
];

/**
 * Coordinates on a 180×260 front/back composite badminton silhouette.
 * Viewed facing the athlete: athlete's RIGHT is on viewer's left (x < 90),
 * athlete's LEFT is on viewer's right (x > 90). Center zones sit at x = 90.
 */
const ZONE_HOTSPOTS: {
  zone: BodyZoneKey;
  side: PainSide;
  cx: number;
  cy: number;
}[] = [
  { zone: "shoulder", side: "right", cx: 58, cy: 62 },
  { zone: "shoulder", side: "left", cx: 122, cy: 62 },
  { zone: "elbow", side: "right", cx: 44, cy: 96 },
  { zone: "elbow", side: "left", cx: 136, cy: 96 },
  { zone: "wrist", side: "right", cx: 36, cy: 128 },
  { zone: "wrist", side: "left", cx: 144, cy: 128 },
  { zone: "back", side: "both", cx: 90, cy: 104 },
  { zone: "hip", side: "right", cx: 72, cy: 134 },
  { zone: "hip", side: "left", cx: 108, cy: 134 },
  { zone: "knee", side: "right", cx: 73, cy: 178 },
  { zone: "knee", side: "left", cx: 107, cy: 178 },
  { zone: "shin", side: "right", cx: 73, cy: 206 },
  { zone: "shin", side: "left", cx: 107, cy: 206 },
  { zone: "achilles", side: "right", cx: 63, cy: 226 },
  { zone: "achilles", side: "left", cx: 117, cy: 226 },
  { zone: "ankle", side: "right", cx: 74, cy: 242 },
  { zone: "ankle", side: "left", cx: 106, cy: 242 },
];

/** Match free-text or localized zone names (ru/en/ro) to a canonical BodyZoneKey. */
export function detectBodyZone(raw: string | null | undefined): BodyZoneKey | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/плеч|shoulder|umăr|umar/.test(s)) return "shoulder";
  if (/локот|локтя|elbow|cot/.test(s)) return "elbow";
  if (/кист|запяст|wrist|hand|încheiet|incheiet|mân|man/.test(s)) return "wrist";
  if (/спин|поясн|back|lombar|spate/.test(s)) return "back";
  if (/бедр|пах|hip|groin|șold|sold|inghinal/.test(s)) return "hip";
  if (/колен|knee|genunchi/.test(s)) return "knee";
  if (/ахил|achil|ahil/.test(s)) return "achilles";
  // Ankle before shin: "голеностоп" contains "голен" — shin must not win it.
  if (/стоп|голеностоп|лодыж|ankle|foot|glezn|picioar|picior/.test(s)) return "ankle";
  if (/голен|икр|shin|calf|gamb/.test(s)) return "shin";
  return null;
}

export function BodyMapPicker({
  zonesDict,
  title,
  location,
  side,
  onSelect,
}: {
  zonesDict: Dictionary["pro"]["bodyZones"];
  title: string;
  location: string | undefined;
  side: PainSide | undefined;
  onSelect: (zoneLabel: string, side?: PainSide) => void;
}) {
  const activeZone = detectBodyZone(location);

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-background/40 p-3">
      <p className="text-xs font-medium text-muted">{title}</p>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <svg
          viewBox="0 0 180 260"
          className="h-56 w-40 shrink-0 select-none"
          aria-label={title}
        >
          {/* Silhouette outline */}
          <g
            fill="currentColor"
            className="text-foreground/10"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="90" cy="28" r="16" />
            {/* Torso */}
            <path d="M62 52 Q90 46 118 52 L114 134 Q90 138 66 134 Z" />
            {/* Arms */}
            <path d="M60 54 L34 128 L44 132 L66 72 Z" />
            <path d="M120 54 L146 128 L136 132 L114 72 Z" />
            {/* Legs */}
            <path d="M68 134 L66 244 L80 244 L84 136 Z" />
            <path d="M96 136 L100 244 L114 244 L112 134 Z" />
          </g>
          {/* R / L orientation markers */}
          <text x="20" y="22" className="fill-muted text-[10px] font-semibold">
            R
          </text>
          <text x="152" y="22" className="fill-muted text-[10px] font-semibold">
            L
          </text>

          {ZONE_HOTSPOTS.map((h, idx) => {
            const isZone = activeZone === h.zone;
            const isSelected =
              isZone &&
              (h.side === "both" ||
                !side ||
                side === "both" ||
                side === h.side);
            return (
              <g
                key={`${h.zone}-${h.side}-${idx}`}
                className="cursor-pointer"
                onClick={() => onSelect(zonesDict[h.zone], h.side)}
              >
                <title>{`${zonesDict[h.zone]} (${h.side})`}</title>
                {/* Invisible wide tap target — the visible dot is too small for fingers. */}
                <circle cx={h.cx} cy={h.cy} r={15} fill="transparent" />
                <circle
                  cx={h.cx}
                  cy={h.cy}
                  r={isSelected ? 9 : 7}
                  className={cn(
                    "transition-all",
                    isSelected
                      ? "fill-danger stroke-surface stroke-2"
                      : "fill-warn/70 hover:fill-danger stroke-surface stroke-1",
                  )}
                />
              </g>
            );
          })}
        </svg>

        <div className="flex flex-1 flex-wrap gap-1.5">
          {BODY_ZONE_KEYS.map((z) => {
            const active = activeZone === z;
            return (
              <button
                key={z}
                type="button"
                onClick={() => onSelect(zonesDict[z])}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-danger bg-danger text-danger-foreground"
                    : "border-border bg-surface hover:bg-foreground/5",
                )}
              >
                {zonesDict[z]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface GroupPainEntry {
  athleteId: string;
  athleteName: string;
  date: string;
  location: string | null;
  side: PainSide | null;
  severity: number | null;
  dominantHit: boolean;
}

export function GroupBodyHeatmap({
  entries,
  dict,
}: {
  entries: GroupPainEntry[];
  dict: Dictionary;
}) {
  const zp = dict.pro.bodyZones;
  if (entries.length === 0) return null;

  const byZone = new Map<BodyZoneKey, GroupPainEntry[]>();
  for (const e of entries) {
    const z = detectBodyZone(e.location);
    if (!z) continue;
    const list = byZone.get(z) ?? [];
    if (!list.some((x) => x.athleteId === e.athleteId)) list.push(e);
    byZone.set(z, list);
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg viewBox="0 0 180 260" className="h-52 w-36 shrink-0 select-none">
        <g
          fill="currentColor"
          className="text-foreground/10"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="90" cy="28" r="16" />
          <path d="M62 52 Q90 46 118 52 L114 134 Q90 138 66 134 Z" />
          <path d="M60 54 L34 128 L44 132 L66 72 Z" />
          <path d="M120 54 L146 128 L136 132 L114 72 Z" />
          <path d="M68 134 L66 244 L80 244 L84 136 Z" />
          <path d="M96 136 L100 244 L114 244 L112 134 Z" />
        </g>
        {ZONE_HOTSPOTS.map((h, idx) => {
          const hits = byZone.get(h.zone) ?? [];
          const count = hits.length;
          return (
            <circle
              key={`${h.zone}-${idx}`}
              cx={h.cx}
              cy={h.cy}
              r={count > 0 ? Math.min(12, 7 + count * 2) : 5}
              className={
                count >= 2
                  ? "fill-danger stroke-surface stroke-2"
                  : count === 1
                    ? "fill-warn stroke-surface stroke-2"
                    : "fill-foreground/15"
              }
            >
              <title>{`${zp[h.zone]}: ${count}`}</title>
            </circle>
          );
        })}
      </svg>

      <div className="flex-1 space-y-2 text-sm">
        <div className="flex flex-wrap gap-2">
          {entries.map((e, i) => {
            const zKey = detectBodyZone(e.location);
            const zLabel = zKey ? zp[zKey] : (e.location ?? dict.coach.hasPain);
            return (
              <Link
                key={`${e.athleteId}-${i}`}
                href={`/coach/athletes/${e.athleteId}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  e.dominantHit
                    ? "border-danger/50 bg-danger/10 text-danger hover:bg-danger/15"
                    : "border-warn/40 bg-warn/10 text-foreground hover:bg-warn/15",
                )}
              >
                <span>{e.athleteName}</span>
                <span className="text-muted">·</span>
                <span>{zLabel}</span>
                {e.severity != null && (
                  <span className="font-semibold tabular-nums">{e.severity}/10</span>
                )}
                {e.dominantHit && (
                  <span title={dict.pro.dominantSideWarn} className="text-danger">
                    ★
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <p className="text-xs text-muted">{dict.pro.bodyMapGroupHint}</p>
        <p className="text-[11px] text-muted/80">{dict.coach.heatLegend}</p>
      </div>
    </div>
  );
}
