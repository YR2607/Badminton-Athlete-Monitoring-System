import type { CourtDiagram } from "@/lib/types";

const TONE_COLOR: Record<string, string> = {
  accent: "#3b82f6",
  ok: "#10b981",
  warn: "#f59e0b",
  danger: "#ef4444",
  muted: "#94a3b8",
};

/**
 * Accessible vector BWF badminton court diagram (0..100 coordinate system).
 * Top half (y: 0..50) is opponent court; bottom half (y: 50..100) is player court.
 */
export function TacticalCourtDiagram({ diagram }: { diagram: CourtDiagram }) {
  return (
    <div className="mx-auto my-2 max-w-[260px] rounded-xl border border-border bg-emerald-950/90 p-2.5 shadow-inner">
      <svg
        viewBox="0 0 100 130"
        role="img"
        aria-label="Badminton tactical court diagram"
        className="w-full select-none"
      >
        <defs>
          {Object.entries(TONE_COLOR).map(([k, color]) => (
            <marker
              key={k}
              id={`arrow-${k}`}
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
            </marker>
          ))}
        </defs>

        {/* Outer court boundary */}
        <rect
          x="6"
          y="6"
          width="88"
          height="118"
          rx="2"
          fill="#065f46"
          stroke="#e2e8f0"
          strokeWidth="1.2"
        />
        {/* Singles sidelines */}
        <line x1="13" y1="6" x2="13" y2="124" stroke="#e2e8f0" strokeWidth="0.7" opacity="0.75" />
        <line x1="87" y1="6" x2="87" y2="124" stroke="#e2e8f0" strokeWidth="0.7" opacity="0.75" />
        {/* Long service lines for doubles */}
        <line x1="6" y1="13" x2="94" y2="13" stroke="#e2e8f0" strokeWidth="0.7" opacity="0.75" />
        <line x1="6" y1="117" x2="94" y2="117" stroke="#e2e8f0" strokeWidth="0.7" opacity="0.75" />
        {/* Short service lines */}
        <line x1="6" y1="47" x2="94" y2="47" stroke="#e2e8f0" strokeWidth="0.8" />
        <line x1="6" y1="83" x2="94" y2="83" stroke="#e2e8f0" strokeWidth="0.8" />
        {/* Center line */}
        <line x1="50" y1="6" x2="50" y2="47" stroke="#e2e8f0" strokeWidth="0.8" />
        <line x1="50" y1="83" x2="50" y2="124" stroke="#e2e8f0" strokeWidth="0.8" />
        {/* Net (center y=65) */}
        <line
          x1="4"
          y1="65"
          x2="96"
          y2="65"
          stroke="#fbbf24"
          strokeWidth="2"
          strokeDasharray="3 1.5"
        />

        {/* Shot trajectory arrows */}
        {(diagram.arrows ?? []).map((a, idx) => {
          const tone = a.tone ?? "accent";
          const color = TONE_COLOR[tone] ?? TONE_COLOR.accent;
          const x1 = 6 + (a.from[0] / 100) * 88;
          const y1 = 6 + (a.from[1] / 100) * 118;
          const x2 = 6 + (a.to[0] / 100) * 88;
          const y2 = 6 + (a.to[1] / 100) * 118;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          return (
            <g key={idx}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth="2"
                strokeDasharray={tone === "muted" ? "3 2" : undefined}
                markerEnd={`url(#arrow-${tone})`}
              />
              <circle cx={mx} cy={my} r="5.5" fill="#0f172a" stroke={color} strokeWidth="1.2" />
              <text
                x={mx}
                y={my + 0.5}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="6"
                fontWeight="800"
                fill="#ffffff"
              >
                {a.label}
              </text>
            </g>
          );
        })}

        {/* Players */}
        {diagram.players.map((p) => {
          const cx = 6 + (p.x / 100) * 88;
          const cy = 6 + (p.y / 100) * 118;
          const fill = p.team === "you" ? "#2563eb" : "#dc2626";
          return (
            <g key={p.id}>
              <circle cx={cx} cy={cy} r="6.8" fill={fill} stroke="#ffffff" strokeWidth="1.4" />
              <text
                x={cx}
                y={cy + 0.5}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="5"
                fontWeight="800"
                fill="#ffffff"
              >
                {p.label.slice(0, 4)}
              </text>
            </g>
          );
        })}

        {/* Shuttlecock position */}
        {diagram.shuttle && (
          <circle
            cx={6 + (diagram.shuttle.x / 100) * 88}
            cy={6 + (diagram.shuttle.y / 100) * 118}
            r="3.2"
            fill="#fde047"
            stroke="#0f172a"
            strokeWidth="1"
          />
        )}
      </svg>
    </div>
  );
}
