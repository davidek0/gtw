type Props = {
  values: number[];
  /** tailwind text-color class; stroke/fill use currentColor */
  tone?: string;
  height?: number;
  area?: boolean;
  /** optional [min,max] expected band drawn behind the line */
  band?: [number, number];
  delay?: number;
};

const W = 300;

function buildPath(values: number[], h: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = h * 0.14;
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return { x, y };
  });
}

function smooth(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1]!;
    const cx = (prev.x + p.x) / 2;
    d += ` C${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
  }
  return d;
}

export function TrendChart({ values, tone = "text-sage-deep", height = 80, area, band, delay = 0 }: Props) {
  const pts = buildPath(values, height);
  const line = smooth(pts);
  const filled = `${line} L${W},${height} L0,${height} Z`;

  let bandRect: { y: number; h: number } | null = null;
  if (band) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = height * 0.14;
    const toY = (v: number) =>
      height - pad - ((Math.min(Math.max(v, min), max) - min) / span) * (height - pad * 2);
    const top = toY(band[1]);
    const bottom = toY(band[0]);
    bandRect = { y: top, h: Math.max(bottom - top, 2) };
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={`h-full w-full ${tone}`}
      aria-hidden="true"
    >
      {bandRect && (
        <rect x="0" y={bandRect.y} width={W} height={bandRect.h} fill="currentColor" opacity="0.08" />
      )}
      {area && (
        <path
          d={filled}
          fill="currentColor"
          opacity="0.18"
          className="fade-fill"
          style={{ animationDelay: `${delay}ms` }}
        />
      )}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="draw-line"
        style={{ animationDelay: `${delay}ms` }}
      />
    </svg>
  );
}
