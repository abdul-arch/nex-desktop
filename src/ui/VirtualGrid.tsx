// Grille virtualisee par rangees : seules les rangees proches de la zone visible sont rendues
// (les images hors ecran ne sont ni chargees ni decodees).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface VGroup<T> {
  title: string;
  subtitle?: string;
  items: T[];
}

interface Row<T> {
  top: number;
  height: number;
  kind: "header" | "cards";
  title?: string;
  subtitle?: string;
  items?: T[];
}

export function VirtualGrid<T>({
  groups,
  minCardWidth,
  aspect,
  metaHeight,
  gap = 10,
  headerHeight = 44,
  renderCard,
  getKey,
}: {
  groups: VGroup<T>[];
  minCardWidth: number;
  /** hauteur / largeur de l'image. */
  aspect: number;
  metaHeight: number;
  gap?: number;
  headerHeight?: number;
  renderCard: (item: T, width: number) => ReactNode;
  getKey: (item: T) => string | number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [view, setView] = useState({ top: 0, bottom: 1200 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = (el.closest(".content") as HTMLElement | null) ?? window;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      setView({ top: -r.top, bottom: -r.top + window.innerHeight });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const cols = Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
  const cardW = (width - gap * (cols - 1)) / cols;
  const rowH = cardW * aspect + metaHeight + gap;

  const { rows, total } = useMemo(() => {
    const out: Row<T>[] = [];
    let y = 0;
    for (const g of groups) {
      if (!g.items.length) continue;
      out.push({ top: y, height: headerHeight, kind: "header", title: g.title, subtitle: g.subtitle });
      y += headerHeight;
      for (let i = 0; i < g.items.length; i += cols) {
        out.push({ top: y, height: rowH, kind: "cards", items: g.items.slice(i, i + cols) });
        y += rowH;
      }
    }
    return { rows: out, total: y };
  }, [groups, cols, rowH, headerHeight]);

  const margin = 600;
  const visible = rows.filter((r) => r.top + r.height >= view.top - margin && r.top <= view.bottom + margin);

  return (
    <div ref={ref} className="vgrid" style={{ height: total }}>
      {visible.map((r) =>
        r.kind === "header" ? (
          <div key={`h-${r.top}`} className="vgrid-header" style={{ top: r.top, height: r.height }}>
            <b>{r.title}</b> {r.subtitle && <span className="muted">{r.subtitle}</span>}
          </div>
        ) : (
          <div key={`r-${r.top}`} className="vgrid-row" style={{ top: r.top, gap, gridTemplateColumns: `repeat(${cols}, ${cardW}px)` }}>
            {r.items!.map((it) => (
              <div key={getKey(it)}>{renderCard(it, cardW)}</div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
