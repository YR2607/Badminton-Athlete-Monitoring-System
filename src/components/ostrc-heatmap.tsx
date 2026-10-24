import type { Dictionary } from "@/i18n";
import type { OstrcResponse, OstrcZone } from "@/lib/types";

type Lang = "ru" | "en" | "ro";

/** Zone × week heatmap by severity band (0 / 1–24 / 25–49 / 50+). */
export function OstrcHeatmap({
  dict,
  lang,
  zones,
  responses,
  weeks = 12,
}: {
  dict: Dictionary;
  lang: string;
  zones: OstrcZone[];
  responses: OstrcResponse[];
  weeks?: number;
}) {
  const d = dict.ostrc;
  const byCell = new Map<string, OstrcResponse>();
  const weekSet = new Set<string>();
  for (const r of responses) {
    byCell.set(`${r.zone_code}:${r.week_start_date}`, r);
    weekSet.add(r.week_start_date);
  }
  const weekList = [...weekSet].sort().slice(-weeks);
  if (!weekList.length) return null;

  const cellCls = (r: OstrcResponse | undefined) => {
    if (!r) return "bg-foreground/5";
    if (r.severity === 0) return "bg-ok/20";
    if (r.severity < 25) return "bg-warn/30";
    if (r.severity < 50) return "bg-warn/60";
    return "bg-danger/50";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate text-xs" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface px-1 text-left font-medium text-muted">
              {d.zone}
            </th>
            {weekList.map((w) => (
              <th key={w} className="px-1 font-normal text-muted">
                {w.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.id}>
              <td className="sticky left-0 whitespace-nowrap bg-surface px-1 py-0.5 font-medium">
                {z.name[lang as Lang] || z.name.en || z.code}
              </td>
              {weekList.map((w) => {
                const r = byCell.get(`${z.code}:${w}`);
                return (
                  <td
                    key={w}
                    title={r ? `${d.severity}: ${r.severity}${r.substantial ? ` · ${d.substantial}` : ""}` : "—"}
                    className={`h-6 min-w-6 rounded text-center align-middle ${cellCls(r)}`}
                  >
                    {r?.substantial ? "!" : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">{d.heatmapHint}</p>
    </div>
  );
}
