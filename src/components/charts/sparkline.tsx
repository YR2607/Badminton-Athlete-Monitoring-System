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
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      {segments.map((s, i) => (
        <polyline
          key={i}
          points={s}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
