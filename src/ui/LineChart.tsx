// Graphique en lignes SVG minimal (2 a 3 series), sans bibliotheque.
export interface Series {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

export function LineChart({
  series,
  height = 140,
  xLabel = (i: number) => `${i}`,
  yFormat = (v: number) => `${Math.round(v)}`,
  zeroLine = false,
  ariaLabel,
}: {
  series: Series[];
  height?: number;
  xLabel?: (i: number) => string;
  yFormat?: (v: number) => string;
  zeroLine?: boolean;
  ariaLabel: string;
}) {
  const width = 520;
  const pad = { l: 44, r: 10, t: 10, b: 20 };
  const n = Math.max(...series.map((s) => s.values.length), 0);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (n < 2 || all.length === 0) return <div className="muted">Pas assez de points.</div>;
  let min = Math.min(...all, zeroLine ? 0 : Infinity);
  let max = Math.max(...all, zeroLine ? 0 : -Infinity);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (i: number) => pad.l + (i / (n - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
  const ticks = [min, (min + max) / 2, max];
  const step = Math.max(1, Math.ceil(n / 8));

  return (
    <figure className="linechart" aria-label={ariaLabel} role="img">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--dim)">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {zeroLine && min < 0 && max > 0 && (
          <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeDasharray="3 3" />
        )}
        {Array.from({ length: n }, (_, i) =>
          i % step === 0 ? (
            <text key={i} x={x(i)} y={height - 5} textAnchor="middle" fontSize="10" fill="var(--dim)">
              {xLabel(i)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          let d = "";
          s.values.forEach((v, i) => {
            if (v === null) return;
            d += `${d ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
          });
          return (
            <path
              key={s.label}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dashed ? "5 4" : undefined}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
      <figcaption className="legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
