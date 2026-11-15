// Graphique en lignes SVG minimal (2 a 3 series), sans bibliotheque.
import { useState } from "react";

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
  onHover,
  compact = false,
}: {
  series: Series[];
  height?: number;
  xLabel?: (i: number) => string;
  yFormat?: (v: number) => string;
  zeroLine?: boolean;
  ariaLabel: string;
  /**
   * Prevenu du point survole, ou de `null` a la sortie. L'absence de cette fonction
   * desactive tout le survol : les graphiques qui ne la passent pas se comportent
   * exactement comme avant, ligne et marqueur compris.
   *
   * Le composant ne dessine PAS d'infobulle : il dit quel point est vise, et l'appelant
   * en fait ce qu'il veut. La carte des LP affiche ainsi le rang et les points dans son
   * en-tete, au lieu d'une bulle qui recouvre la courbe.
   */
  onHover?: (i: number | null) => void;
  /** Sans axes, sans graduations, sans legende : une sparkline. */
  compact?: boolean;
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

  /**
   * Index du point survole, ou `null`. Le calcul passe par la `viewBox` et non par les
   * pixels : `preserveAspectRatio="none"` etire l'horizontale, donc une unite SVG ne vaut
   * pas un pixel ecran. Lire `clientX` sans cette conversion decale le point des que le
   * conteneur n'est pas large de 520 px — c'est-a-dire toujours.
   */
  const [survol, setSurvol] = useState<number | null>(null);
  const viser = (i: number | null) => {
    setSurvol(i);
    onHover?.(i);
  };
  const pointer = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onHover) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0) return;
    const enUnites = ((e.clientX - r.left) / r.width) * width;
    const i = Math.round(((enUnites - pad.l) / (width - pad.l - pad.r)) * (n - 1));
    viser(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <figure className="linechart" aria-label={ariaLabel} role="img">
      <div className="linechart-zone">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        onPointerMove={pointer}
        onPointerDown={pointer}
        onPointerLeave={() => viser(null)}
        style={onHover ? { touchAction: "pan-y" } : undefined}
      >
        {!compact &&
          ticks.map((t, i) => (
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
        {!compact &&
          Array.from({ length: n }, (_, i) =>
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
        {survol !== null && onHover && (
          <g className="linechart-survol" pointerEvents="none">
            <line x1={x(survol)} x2={x(survol)} y1={pad.t} y2={height - pad.b} stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 4" />
            {series.map((s) => {
              const v = s.values[survol];
              if (v === null || v === undefined) return null;
              return <circle key={s.label} cx={x(survol)} cy={y(v)} r="4.5" fill="var(--panel)" stroke={s.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />;
            })}
          </g>
        )}
      </svg>
      </div>
      {!compact && (
      <figcaption className="legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </figcaption>
      )}
    </figure>
  );
}
