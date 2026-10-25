export function Sparkline({
  points,
  width = 96,
  height = 28,
  domain = [0, 100],
  className,
}: {
  points: (number | null)[];
  width?: number;
  height?: number;
  domain?: [number, number];
  className?: string;
}) {
  const values = points.filter((p): p is number => p !== null);
  if (values.length === 0) return null;
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const xy = points.map((p, i) =>
    p === null
      ? null
      : `${(i * step).toFixed(1)},${(height - ((p - lo) / span) * (height - 4) - 2).toFixed(1)}`,
  );
  const segments: string[] = [];
  let cur: string[] = [];
  for (const p of xy) {
    if (p === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) segments.push(cur.join(" "));
  const gid = `sp-${width}-${height}`;
  const last = xy.filter((p): p is string => p !== null).at(-1);
  const [lx, ly] = last ? last.split(",").map(Number) : [0, 0];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {segments.map((s, i) => {
        const pts = s.split(" ");
        const x0 = pts[0].split(",")[0];
        const x1 = pts[pts.length - 1].split(",")[0];
        return (
          <g key={i}>
            <polygon
              points={`${x0},${height} ${s} ${x1},${height}`}
              fill={`url(#${gid})`}
              stroke="none"
            />
            <polyline
              points={s}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
      {last ? <circle cx={lx} cy={ly} r={2} fill="currentColor" /> : null}
    </svg>
  );
}
