// Interface de la fenetre d'overlay (transparente). Volontairement legere : pas de shell,
// pas de navigation, aucun appel reseau hors catalogue et build du champion joue.
import { useEffect, useMemo, useRef, useState } from "react";
import { platform } from "../platform";
import type { Catalog, ChampionBuildDto, LiveSnapshot, WidgetId, WidgetLayout, WinProbDto } from "../platform/api";
import { MayhemLayer } from "./MayhemLayer";
import { renderWidget } from "./render";

export function OverlayApp() {
  const [layout, setLayout] = useState<WidgetLayout[]>([]);
  const [config, setConfig] = useState(false);
  const [hold, setHold] = useState(false);
  const [snap, setSnap] = useState<{ s: LiveSnapshot | null; at: number }>({ s: null, at: 0 });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [keys, setKeys] = useState<"AZER" | "QWER">("AZER");
  const [build, setBuild] = useState<ChampionBuildDto | null>(null);
  const [grid, setGrid] = useState<WinProbDto | null>(null);
  const [now, setNow] = useState(performance.now());
  // Widgets fermes a la croix : masques jusqu'a la partie suivante, sans toucher
  // a la disposition enregistree (la page Overlays reste la source de verite).
  const [closed, setClosed] = useState<WidgetId[]>([]);

  useEffect(() => {
    document.documentElement.classList.add("overlay-root");
    const offs: (() => void)[] = [];
    let alive = true;
    (async () => {
      const [l, m, s] = await Promise.all([platform.overlayLayoutGet(), platform.overlayMode(), platform.liveSnapshot()]);
      if (!alive) return;
      setLayout(l);
      setConfig(m);
      setSnap({ s, at: performance.now() });
      offs.push(await platform.on<WidgetLayout[]>("overlay://layout", setLayout));
      offs.push(await platform.on<boolean>("overlay://mode", setConfig));
      offs.push(await platform.on<boolean>("overlay://hold", setHold));
      offs.push(await platform.on<LiveSnapshot | null>("live://snapshot", (p) => setSnap({ s: p, at: performance.now() })));
      platform.getSettings().then((st) => alive && setKeys(st.abilityKeys)).catch(() => {});
      platform.staticCatalog().then((c) => alive && setCatalog(c)).catch(() => {});
      platform.staticDataVersion().then((v) => alive && setVersion(v.version)).catch(() => {});
      // Grille chargee une fois : elle ne bouge qu'au rythme de la collecte.
      platform.statsWinprob().then((g) => alive && setGrid(g)).catch(() => alive && setGrid(null));
    })();
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, []);

  // Une nouvelle partie reaffiche tout ce qui avait ete ferme a la croix.
  useEffect(() => {
    if (!snap.s) setClosed((c) => (c.length === 0 ? c : []));
  }, [snap.s]);

  // Une seule minuterie a 1 Hz, seulement pendant une partie.
  useEffect(() => {
    if (!snap.s) return;
    const id = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(id);
  }, [snap.s]);

  const me = snap.s?.players.find((p) => p.isActive) ?? null;
  const champId = useMemo(() => {
    if (!me?.championKey || !catalog) return null;
    const e = Object.entries(catalog.champions).find(([, c]) => c.key === me.championKey);
    return e ? Number(e[0]) : null;
  }, [me?.championKey, catalog]);

  // Build observe : charge une fois par champion.
  useEffect(() => {
    if (!champId) return;
    let alive = true;
    platform
      .statsBuild(champId, { position: me?.position ?? undefined, patch: "all" })
      .then((b) => alive && setBuild(b))
      .catch(() => alive && setBuild(null));
    return () => {
      alive = false;
    };
  }, [champId]); // eslint-disable-line react-hooks/exhaustive-deps

  const gameTime = snap.s ? snap.s.gameTime + Math.min(5, Math.max(0, (now - snap.at) / 1000)) : null;

  // En configuration, pas de croix : on y place les widgets, on ne les ferme pas.
  const inputs = { snap: snap.s, gameTime, catalog, version, keys, build, grid, config, onClose: config ? undefined : (id: WidgetId) => setClosed((c) => (c.includes(id) ? c : [...c, id])) };

  return (
    <div className={`ov-surface ${config ? "config" : ""}`}>
      {config && (
        <div className="ov-config-bar">
          <span>
            <b>Mode configuration</b> : glisse les widgets avec la souris · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> pour terminer
            <em>
              Si rien ne bouge en jeu, mets League en <b>Sans bordure</b> (Options → Vidéo → Mode fenêtre). En plein écran exclusif, Windows interdit à
              toute application de passer au-dessus du jeu.
            </em>
          </span>
          <button onClick={() => platform.overlaySetMode(false)}>Terminer</button>
        </div>
      )}
      <MayhemLayer />
      {layout
        // « Sur une touche » : masque sauf pendant le rappel. En mode configuration tout
        // reste visible, sinon on ne pourrait pas placer un widget qu'on ne voit pas.
        .filter((w) => w.visible && !closed.includes(w.id) && (config || w.mode !== "hold" || hold))
        .map((w) => (
          <Draggable key={w.id} w={w} config={config} onDrop={(nw) => platform.overlayLayoutSet(nw).then(setLayout).catch(() => {})}>
            {renderWidget(w.id, inputs)}
          </Draggable>
        ))}
    </div>
  );
}

function Draggable({ w, config, onDrop, children }: { w: WidgetLayout; config: boolean; onDrop: (w: WidgetLayout) => void; children: React.ReactNode }) {
  const [pos, setPos] = useState({ x: w.x, y: w.y });
  // Position courante lue au relachement (pas de valeur figee par une fermeture).
  const posRef = useRef(pos);
  const drag = useRef<{ dx: number; dy: number; maxX: number; maxY: number } | null>(null);
  useEffect(() => {
    if (drag.current) return; // une mise a jour externe n'interrompt pas un glisser en cours
    posRef.current = { x: w.x, y: w.y };
    setPos(posRef.current);
  }, [w.x, w.y]);
  if (!children) return null;
  const movable = config && !w.locked;
  const end = (save: boolean) => {
    if (!drag.current) return;
    drag.current = null;
    if (save) onDrop({ ...w, x: posRef.current.x, y: posRef.current.y });
  };
  return (
    <div
      className={`ov-widget ${movable ? "movable" : ""} ${config && w.locked ? "locked" : ""}`}
      style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, transform: `scale(${w.scale})`, opacity: w.opacity }}
      title={config && w.locked ? "Widget verrouillé (page Overlays)" : undefined}
      onPointerDown={(e) => {
        if (!movable || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        // Bornes : le widget reste entierement a l'ecran, echelle comprise.
        const r = e.currentTarget.getBoundingClientRect();
        drag.current = {
          dx: e.clientX / innerWidth - posRef.current.x,
          dy: e.clientY / innerHeight - posRef.current.y,
          maxX: Math.max(0, 1 - r.width / innerWidth),
          maxY: Math.max(0, 1 - r.height / innerHeight),
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
        posRef.current = { x: clamp(e.clientX / innerWidth - d.dx, d.maxX), y: clamp(e.clientY / innerHeight - d.dy, d.maxY) };
        setPos(posRef.current);
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(true)}
      onLostPointerCapture={() => end(true)}
    >
      {children}
    </div>
  );
}

