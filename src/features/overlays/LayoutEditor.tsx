// Editeur de disposition : miniature de l'ecran ou les widgets se deplacent a la souris
// (ou aux fleches du clavier). Les positions sont les memes fractions d'ecran que l'overlay ;
// chaque depot est enregistre et l'overlay ouvert se met a jour en direct.
import { useEffect, useRef, useState } from "react";
import type { WidgetId, WidgetLayout } from "../../platform/api";
import { WIDGET_INFO } from "./widgets";

/** Taille approximative de chaque widget (px CSS a l'echelle 1, cf. overlay.css). */
const SIZE: Record<WidgetId, [number, number]> = {
  clock: [190, 84],
  objectives: [190, 56],
  build: [230, 66],
  skills: [190, 58],
  trinket: [230, 50],
};

/** Reperes approximatifs du HUD de League (fractions d'un ecran 16:9). */
const HUD = [
  { label: "Mini-carte", x: 0.855, y: 0.745, w: 0.145, h: 0.255 },
  { label: "Sorts et objets", x: 0.33, y: 0.865, w: 0.34, h: 0.135 },
  { label: "Score", x: 0.84, y: 0, w: 0.16, h: 0.035 },
];

export function LayoutEditor({ layout, onChange }: { layout: WidgetLayout[]; onChange: (w: WidgetLayout) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [selected, setSelected] = useState<WidgetId | null>(null);
  // Derniere position du glisser, lue au relachement (independante du rendu).
  const drag = useRef<{ id: WidgetId; dx: number; dy: number; last: { x: number; y: number } } | null>(null);
  const screenW = window.screen.width || 1920;
  const screenH = window.screen.height || 1080;

  // Positions enregistrees -> affichage (sauf pendant un glisser).
  useEffect(() => {
    if (drag.current) return;
    setPos(Object.fromEntries(layout.map((w) => [w.id, { x: w.x, y: w.y }])));
  }, [layout]);

  const box = (w: WidgetLayout) => {
    const [bw, bh] = SIZE[w.id];
    return { fw: Math.min(1, (bw * w.scale) / screenW), fh: Math.min(1, (bh * w.scale) / screenH) };
  };
  const clamp = (w: WidgetLayout, x: number, y: number) => {
    const { fw, fh } = box(w);
    return { x: Math.min(Math.max(0, x), 1 - fw), y: Math.min(Math.max(0, y), 1 - fh) };
  };
  const frac = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
  };
  const commit = (w: WidgetLayout, p: { x: number; y: number }) => {
    const r = (v: number) => Math.round(v * 10000) / 10000;
    onChange({ ...w, x: r(p.x), y: r(p.y) });
  };

  return (
    <div className="layout-editor">
      <div
        ref={ref}
        className="layout-screen"
        style={{ aspectRatio: `${screenW} / ${screenH}` }}
        role="application"
        aria-label="Disposition des widgets sur l'écran. Sélectionne un widget puis utilise les flèches (Maj : pas plus grand)."
      >
        {HUD.map((h) => (
          <div key={h.label} className="layout-hud" style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%` }}>
            {h.label}
          </div>
        ))}
        {layout.map((w) => {
          const p = pos[w.id] ?? { x: w.x, y: w.y };
          const { fw, fh } = box(w);
          const movable = !w.locked;
          return (
            <button
              key={w.id}
              type="button"
              className={`layout-widget ${w.visible ? "" : "hidden"} ${w.locked ? "locked" : ""} ${selected === w.id ? "selected" : ""}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${fw * 100}%`, height: `${fh * 100}%` }}
              title={`${WIDGET_INFO[w.id].name}${w.locked ? " (verrouillé)" : ""}${w.visible ? "" : " (masqué)"}`}
              aria-label={`${WIDGET_INFO[w.id].name} : ${Math.round(p.x * 100)} % depuis la gauche, ${Math.round(p.y * 100)} % depuis le haut${w.locked ? ", verrouillé" : ""}`}
              onFocus={() => setSelected(w.id)}
              onPointerDown={(e) => {
                setSelected(w.id);
                if (!movable || e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const { fx, fy } = frac(e);
                drag.current = { id: w.id, dx: fx - p.x, dy: fy - p.y, last: p };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== w.id) return;
                const { fx, fy } = frac(e);
                d.last = clamp(w, fx - d.dx, fy - d.dy);
                setPos((s) => ({ ...s, [w.id]: d.last }));
              }}
              onPointerUp={() => {
                const d = drag.current;
                if (d?.id !== w.id) return;
                drag.current = null;
                commit(w, d.last);
              }}
              onLostPointerCapture={() => {
                const d = drag.current;
                if (d?.id !== w.id) return;
                drag.current = null;
                commit(w, d.last);
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.05 : 0.01;
                const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                if (!d || !movable) return;
                e.preventDefault();
                const n = clamp(w, p.x + d[0], p.y + d[1]);
                setPos((s) => ({ ...s, [w.id]: n }));
                commit(w, n);
              }}
            >
              <span>{WIDGET_INFO[w.id].name}</span>
            </button>
          );
        })}
      </div>
      <p className="muted layout-help">
        Glisse un widget pour le déplacer (ou sélectionne-le et utilise les flèches, <kbd>Maj</kbd> pour un pas plus grand). Les zones grises sont des
        repères approximatifs du HUD du jeu. L'overlay ouvert se met à jour immédiatement. En partie, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> permet aussi
        de les déplacer directement sur le jeu.
      </p>
    </div>
  );
}
