// Distribution horizontale des adversaires selon l'ecart (en points) au taux moyen du champion.
// L'empilement vertical sert uniquement a eviter les chevauchements : il ne porte aucune metrique.
import { useMemo, useRef, useState } from "react";
import { useDDragonVersion } from "../../app/AppState";
import type { MatchupDto } from "../../platform/api";
import { pct } from "../../ui/format";
import { ChampIcon } from "../../ui/primitives";

export const FAVORABLE_PP = 2;

export interface Placed {
  m: MatchupDto;
  x: number;
  row: number;
}

/** Placement glouton : chaque portrait prend la premiere rangee libre (0, -1, +1, -2, +2...). */
export function layout(items: MatchupDto[], scale: (d: number) => number, size: number): Placed[] {
  const rows = new Map<number, number[]>();
  const order = [...items].sort((a, b) => a.deltaPp - b.deltaPp);
  const out: Placed[] = [];
  for (const m of order) {
    const x = scale(m.deltaPp);
    for (let k = 0; ; k++) {
      const row = k === 0 ? 0 : k % 2 ? -Math.ceil(k / 2) : k / 2;
      const xs = rows.get(row) ?? [];
      if (xs.every((x2) => Math.abs(x2 - x) >= size + 2)) {
        xs.push(x);
        rows.set(row, xs);
        out.push({ m, x, row });
        break;
      }
    }
  }
  return out;
}

export function DistributionChart({
  matchups,
  average,
  nameOf,
  keyOf,
  onOpen,
  highlight,
}: {
  matchups: MatchupDto[];
  average: number;
  nameOf: (id: number) => string;
  keyOf: (id: number) => string;
  onOpen: (id: number) => void;
  highlight?: number | null;
}) {
  const version = useDDragonVersion();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Placed | null>(null);
  const width = 1000; // espace logique ; mis a l'echelle en CSS (pourcentages)
  const size = 30;
  const range = Math.max(10, Math.ceil(Math.max(0, ...matchups.map((m) => Math.abs(m.deltaPp))) / 5) * 5);
  const scale = (d: number) => ((Math.max(-range, Math.min(range, d)) + range) / (2 * range)) * (width - size) + size / 2;
  const placed = useMemo(() => layout(matchups, scale, size), [matchups, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const minRow = Math.min(0, ...placed.map((p) => p.row));
  const maxRow = Math.max(0, ...placed.map((p) => p.row));
  const height = Math.max(180, (maxRow - minRow + 1) * (size + 4) + 24);
  const yOf = (row: number) => 12 + (row - minRow) * (size + 4);

  return (
    <div className="dist">
      <div className="dist-area" ref={ref} style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="dist-bg" aria-hidden="true" />
        <div className="dist-zero" style={{ left: `${(scale(0) / width) * 100}%` }} aria-hidden="true" />
        {placed.map((p) => {
          const fav = p.m.deltaPp >= FAVORABLE_PP;
          const hard = p.m.deltaPp <= -FAVORABLE_PP;
          return (
            <button
              key={p.m.opponentId}
              className={`dist-dot ${fav ? "fav" : hard ? "hard" : "even"} ${highlight === p.m.opponentId ? "hl" : ""}`}
              style={{ left: `calc(${(p.x / width) * 100}% - ${size / 2}px)`, top: yOf(p.row), width: size, height: size }}
              onMouseEnter={() => setHover(p)}
              onFocus={() => setHover(p)}
              onBlur={() => setHover(null)}
              onClick={() => onOpen(p.m.opponentId)}
              aria-label={`${nameOf(p.m.opponentId)} : ${pct(p.m.winRate, 1)} de victoires, ${p.m.deltaPp >= 0 ? "+" : "−"}${Math.abs(p.m.deltaPp).toFixed(1)} points, ${p.m.games} parties. Ouvrir le duel`}
            >
              <ChampIcon version={version} champion={keyOf(p.m.opponentId)} size={size - 4} rounded={(size - 4) / 2} />
            </button>
          );
        })}
        {hover && (
          <div
            className="dist-tip"
            role="tooltip"
            style={{ left: `clamp(8px, calc(${(hover.x / width) * 100}% - 110px), calc(100% - 228px))`, top: yOf(hover.row) + size + 6 }}
          >
            <strong>{nameOf(hover.m.opponentId)}</strong>
            <div className="num">
              Victoires : {pct(hover.m.winRate, 1)} ({hover.m.wins}/{hover.m.games})
            </div>
            <div className="num">
              Écart : {hover.m.deltaPp >= 0 ? "+" : "−"}
              {Math.abs(hover.m.deltaPp).toFixed(1)} pts{" "}
              <span className="muted">
                ({hover.m.deltaPp >= 0 ? "+" : "−"}
                {average > 0 ? Math.abs((hover.m.deltaPp / 100 / average) * 100).toFixed(0) : "—"} % relatif)
              </span>
            </div>
            <div className="muted">Clic : détail du duel</div>
          </div>
        )}
      </div>
      <div className="dist-axis">
        <span>
          Difficile <span className="num">−{range} pts</span>
        </span>
        <span>Moyenne ({pct(average, 1)})</span>
        <span>
          <span className="num">+{range} pts</span> Favorable
        </span>
      </div>
    </div>
  );
}
