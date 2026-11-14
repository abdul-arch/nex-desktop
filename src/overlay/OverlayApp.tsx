// Interface de la fenetre d'overlay (transparente). Volontairement legere : pas de shell,
// pas de navigation, aucun appel reseau hors catalogue et build du champion joue.
import { useEffect, useMemo, useRef, useState } from "react";
import { platform } from "../platform";
import type { Catalog, ChampionBuildDto, ChampionSpell, LiveSnapshot, WidgetId, WidgetLayout, WinProbDto } from "../platform/api";
import { MayhemLayer } from "./MayhemLayer";
import { LoadingPanel } from "./LoadingPanel";
import { renderWidget } from "./render";
import { snapPoint } from "../domain/snap";
import { suggest } from "../features/matchups/draftLogic";
import type { WidgetInputs } from "./render";

export function OverlayApp() {
  const [layout, setLayout] = useState<WidgetLayout[]>([]);
  const [config, setConfig] = useState(false);
  const [hold, setHold] = useState(false);
  const [snap, setSnap] = useState<{ s: LiveSnapshot | null; at: number }>({ s: null, at: 0 });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [keys, setKeys] = useState<"AZER" | "QWER">("AZER");
  const [snapOn, setSnapOn] = useState(true);
  const [bgAlpha, setBgAlpha] = useState(86);
  const [counters, setCounters] = useState<WidgetInputs["counters"]>(null);
  // Champion choisi en selection : alimente le build quand la partie n'a pas commence.
  const [draftPick, setDraftPick] = useState<{ id: number; position: string | null } | null>(null);
  const [build, setBuild] = useState<ChampionBuildDto | null>(null);
  const [grid, setGrid] = useState<WinProbDto | null>(null);
  const [spells, setSpells] = useState<ChampionSpell[]>([]);
  const [now, setNow] = useState(performance.now());
  // Widgets fermes a la croix : masques jusqu'a la partie suivante, sans toucher
  // a la disposition enregistree (la page Overlays reste la source de verite).
  const [closed, setClosed] = useState<WidgetId[]>([]);
  // Pendant l'ecran de chargement, le panneau des dix joueurs occupe l'ecran et les
  // widgets de partie n'ont rien a montrer : ils s'effacent, sauf en configuration ou
  // l'on vient justement les placer.
  const [loading, setLoading] = useState(false);

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
      platform
        .getSettings()
        .then((st) => {
          if (!alive) return;
          setKeys(st.abilityKeys);
          setSnapOn(st.overlaySnap ?? true);
          setBgAlpha(st.overlayBackground ?? 86);
        })
        .catch(() => {});
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

  // Champion a suivre : celui de la partie si elle a commence, sinon celui choisi en
  // selection. Le build sert aux deux phases, charge une fois par champion et par poste.
  const target = champId ? { id: champId, position: me?.position ?? null } : draftPick;
  const targetKey = target ? `${target.id}:${target.position ?? ""}` : null;
  useEffect(() => {
    if (!target) {
      setBuild(null);
      return;
    }
    let alive = true;
    platform
      .statsBuild(target.id, { position: target.position ?? undefined, patch: "all" })
      .then((b) => alive && setBuild(b))
      .catch(() => alive && setBuild(null));
    return () => {
      alive = false;
    };
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counters : seulement pendant la selection des champions, et seulement une fois
  // l'adversaire de voie choisi. Hors selection, `champSelect()` rend `null` et le widget
  // disparait de lui-meme.
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const cs = await platform.champSelect().catch(() => null);
      if (!cs) {
        if (alive) {
          setCounters(null);
          setDraftPick(null);
        }
        return;
      }
      const mine = cs.myTeam.find((x) => x.cellId === cs.localCell);
      const role = mine?.position ?? null;
      setDraftPick(mine && mine.championId > 0 ? { id: mine.championId, position: role } : null);
      const enemy = role ? cs.theirTeam.find((x) => x.position === role && x.championId > 0) : null;
      if (!role || !enemy) return alive && setCounters(null);
      const params = { position: role, patch: "all" };
      const [tier, mu] = await Promise.all([
        platform.statsTierList(params).catch(() => null),
        platform.statsMatchups(enemy.championId, params).catch(() => null),
      ]);
      if (!alive || !tier) return;
      // Champions deja pris ou bannis : inutiles a proposer.
      const used = new Set<number>(
        [...cs.myTeam, ...cs.theirTeam].map((x) => x.championId).concat(cs.myBans, cs.theirBans).filter((id) => id > 0),
      );
      const nameOf = (id: number) => catalog?.champions[String(id)]?.name ?? `Champion ${id}`;
      setCounters({ enemy: nameOf(enemy.championId), items: suggest(tier.champions, mu, used, 5, nameOf, 3) });
    };
    void read();
    const id = window.setInterval(read, 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [catalog]);

  // Sorts du champion joue : charges une fois par champion, pour l'icone du rappel de
  // competence. Donnees statiques Data Dragon, aucune information de partie.
  const champKey = me?.championKey ?? null;
  useEffect(() => {
    if (!champKey) {
      setSpells([]);
      return;
    }
    let alive = true;
    platform
      .championInfo(champKey)
      .then((c) => alive && setSpells(c.spells))
      .catch(() => alive && setSpells([]));
    return () => {
      alive = false;
    };
  }, [champKey]);

  const gameTime = snap.s ? snap.s.gameTime + Math.min(5, Math.max(0, (now - snap.at) / 1000)) : null;

  // En configuration, pas de croix : on y place les widgets, on ne les ferme pas.
  const inputs = { snap: snap.s, gameTime, catalog, version, keys, build, spells, grid, counters, config, onClose: config ? undefined : (id: WidgetId) => setClosed((c) => (c.includes(id) ? c : [...c, id])) };

  return (
    <div className={`ov-surface ${config ? "config" : ""}`} style={{ ["--ov-bg" as string]: (bgAlpha / 100).toFixed(2) }}>
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
      <LoadingPanel catalog={catalog} live={!!snap.s} onActive={setLoading} />
      {(!loading || config) &&
        layout
        // « Sur une touche » : masque sauf pendant le rappel. En mode configuration tout
        // reste visible, sinon on ne pourrait pas placer un widget qu'on ne voit pas.
        .filter((w) => w.visible && !closed.includes(w.id) && (config || w.mode !== "hold" || hold))
        .map((w) => (
          <Draggable
            key={w.id}
            w={w}
            config={config}
            snap={snapOn}
            others={layout.filter((o) => o.id !== w.id).map((o) => ({ x: o.x, y: o.y }))}
            onDrop={(nw) => platform.overlayLayoutSet(nw).then(setLayout).catch(() => {})}
          >
            {renderWidget(w.id, inputs)}
          </Draggable>
        ))}
    </div>
  );
}

function Draggable({
  w,
  config,
  snap,
  others,
  onDrop,
  children,
}: {
  w: WidgetLayout;
  config: boolean;
  snap: boolean;
  others: { x: number; y: number }[];
  onDrop: (w: WidgetLayout) => void;
  children: React.ReactNode;
}) {
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
        const raw = { x: clamp(e.clientX / innerWidth - d.dx, d.maxX), y: clamp(e.clientY / innerHeight - d.dy, d.maxY) };
        // Maj enfoncee : placement libre, sans aimantation.
        const aimed = snapPoint(raw, others, snap && !e.shiftKey);
        posRef.current = { x: clamp(aimed.x, d.maxX), y: clamp(aimed.y, d.maxY) };
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

