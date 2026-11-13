// Interface de la fenetre d'overlay (transparente). Volontairement legere : pas de shell,
// pas de navigation, aucun appel reseau hors catalogue et build du champion joue.
import { useEffect, useMemo, useRef, useState } from "react";
import { skillLabel } from "../domain/fromMatch";
import { platform } from "../platform";
import type { Catalog, ChampionBuildDto, LiveSnapshot, WidgetId, WidgetLayout, WinProbDto } from "../platform/api";
import { championIcon, itemIcon } from "../data/assets";
import { kdiff, kgold, teamGold } from "../domain/livegold";
import { winProbability } from "../domain/winprob";
import { MayhemLayer } from "./MayhemLayer";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const OBJ_NAMES: Record<string, string> = { dragon: "Dragon", elder: "Dragon ancestral", baron: "Baron Nashor" };

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
  const shut = (id: WidgetId) => (config ? undefined : () => setClosed((c) => (c.includes(id) ? c : [...c, id])));

  const content: Record<WidgetId, React.ReactNode> = {
    gold: GoldWidget({ snap: snap.s, gameTime, config, onClose: shut("gold") }),
    winprob: WinProbWidget({ snap: snap.s, gameTime, grid, config, onClose: shut("winprob") }),
    clock: (
      <Widget title="Partie" onClose={shut("clock")}>
        {gameTime === null ? (
          <span className="ov-wait">En attente de partie</span>
        ) : !me ? (
          // Mode spectateur : le jeu ne fournit pas de « joueur actif » (Live Client Data).
          <div className="ov-clock">
            <b className="num">{mmss(gameTime)}</b>
            <span className="ov-wait">Spectateur : pas de statistiques personnelles</span>
          </div>
        ) : (
          <div className="ov-clock">
            <b className="num">{mmss(gameTime)}</b>
            <span className="num">
              {me.cs} CS · {(me.cs / Math.max(1, gameTime / 60)).toFixed(1)}/min
            </span>
            <span className="num">
              {me.kills}/{me.deaths}/{me.assists} · KDA {((me.kills + me.assists) / Math.max(1, me.deaths)).toFixed(1)}
            </span>
          </div>
        )}
      </Widget>
    ),
    objectives: (
      <Widget title="Objectifs" onClose={shut("objectives")}>
        {!snap.s || gameTime === null ? (
          <span className="ov-wait">En attente de partie</span>
        ) : snap.s.objectives.length === 0 ? (
          <span className="ov-wait">Aucun minuteur vérifiable</span>
        ) : (
          snap.s.objectives.map((o) => (
            <div key={o.kind} className="ov-row">
              <span>{OBJ_NAMES[o.kind] ?? o.kind}</span>
              <b className="num">{mmss(Math.max(0, o.nextSpawn - gameTime))}</b>
            </div>
          ))
        )}
      </Widget>
    ),
    // Appeles comme des fonctions (sans hooks) : `null` signifie vraiment « rien a afficher »,
    // sans conteneur vide a l'ecran.
    build: BuildWidget({ build, owned: me?.items ?? [], catalog, version, live: !!snap.s, config, onClose: shut("build") }),
    skills: SkillWidget({ snap: snap.s, build, keys, config, onClose: shut("skills"), championKey: me?.championKey ?? null, version }),
    trinket:
      snap.s && me && snap.s.activeLevel >= 9 && me.items.includes(3340) ? (
        <Widget title="Trinket" onClose={shut("trinket")}>
          <span>Niveau 9 : passer à la lentille d'oracle ?</span>
        </Widget>
      ) : config ? (
        <Widget title="Trinket">
          <span className="ov-wait">Rappel au niveau 9</span>
        </Widget>
      ) : null,
  };

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
            {content[w.id] ?? (config ? <Widget title={w.id}><span className="ov-wait">Aucune donnée</span></Widget> : null)}
          </Draggable>
        ))}
    </div>
  );
}

function Widget({ title, onClose, children }: { title: string; onClose?: () => void; children: React.ReactNode }) {
  return (
    <div className="ov-widget-box">
      <div className="ov-head">
        <span className="ov-title">{title}</span>
        {onClose && (
          // `onPointerDown` arrete le glisser-deposer : sans cela, un clic sur la croix
          // commencerait un deplacement du widget.
          <button type="button" className="ov-close" aria-label={`Masquer ${title}`} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      {children}
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

function BuildWidget({
  build,
  owned,
  catalog,
  version,
  live,
  config,
  onClose,
}: {
  build: ChampionBuildDto | null;
  owned: number[];
  catalog: Catalog | null;
  version: string | null;
  live: boolean;
  config: boolean;
  onClose?: () => void;
}) {
  if (!live) return <Widget title="Prochain objet" onClose={onClose}><span className="ov-wait">En attente de partie</span></Widget>;
  const core = build?.coreItems[0]?.ids ?? [];
  if (!build || core.length === 0)
    // En configuration, un widget sans donnee reste visible pour pouvoir etre place.
    return config ? <Widget title="Prochain objet"><span className="ov-wait">Pas de build observé pour ce champion</span></Widget> : null;
  const next = core.find((id) => !owned.includes(id));
  if (!next) return <Widget title="Prochain objet" onClose={onClose}><span className="ov-wait">Build principal terminé</span></Widget>;
  const item = catalog?.items[String(next)];
  const src = itemIcon(version, next);
  return (
    <Widget title="Prochain objet" onClose={onClose}>
      <div className="ov-item">
        {src && <img src={src} alt="" width={34} height={34} />}
        <div>
          <b>{item?.name ?? `Objet ${next}`}</b>
          <span className="ov-sub">
            Build observé · {build.coreItems[0].games} parties{item?.gold ? ` · ${item.gold} PO` : ""}
          </span>
        </div>
      </div>
    </Widget>
  );
}

function SkillWidget({
  snap,
  build,
  keys,
  config,
  onClose,
  championKey,
  version,
}: {
  snap: LiveSnapshot | null;
  build: ChampionBuildDto | null;
  keys: "AZER" | "QWER";
  config: boolean;
  onClose?: () => void;
  championKey: string | null;
  version: string | null;
}) {
  if (!snap || snap.unspentPoints === 0)
    return config ? (
      <Widget title="Compétence">
        <span className="ov-wait">S'affiche quand un point est à placer</span>
      </Widget>
    ) : null;
  const lvl = snap.activeLevel;
  const [q, w, e, r] = snap.abilities;
  const ranks = [q, w, e];
  // R aux niveaux 6/11/16 si possible ; sinon la priorite observee (rang max 5, rang <= ceil(niveau/2)).
  let pick: number | null = null;
  if ([6, 11, 16].includes(lvl) && r < Math.floor((lvl - 1) / 5)) pick = 4;
  if (!pick) {
    const order = build?.skillPriority[0]?.ids ?? [1, 2, 3];
    pick = order.find((s) => ranks[s - 1] < 5 && ranks[s - 1] < Math.ceil(lvl / 2)) ?? null;
  }
  // Barre horizontale : portrait du champion, touche a presser, puis les rangs actuels
  // des quatre competences. Les rangs viennent de l'instantane, jamais d'une estimation.
  const portrait = championKey ? championIcon(version, championKey) : null;
  const allRanks: [number, number, number, number] = [q, w, e, r];
  return (
    <div className="ov-skill-bar" title={build?.skillPriority[0] ? "Priorité observée" : "Priorité par défaut"}>
      {portrait ? (
        <img className="ov-skill-portrait" src={portrait} alt="" width={30} height={30} />
      ) : (
        <span className="ov-skill-portrait placeholder" aria-hidden="true" />
      )}
      {pick ? (
        <kbd className="ov-skill-key">{skillLabel(pick, keys)}</kbd>
      ) : (
        <span className="ov-sub">{snap.unspentPoints} à placer</span>
      )}
      <span className="ov-skill-ranks">
        {allRanks.map((rank, i) => (
          <i key={i} className={`ov-pip ${pick === i + 1 ? "next" : rank > 0 ? "on" : ""}`} aria-hidden="true" />
        ))}
      </span>
      {onClose && (
        <button type="button" className="ov-close" aria-label="Masquer le rappel de compétence" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Or des deux equipes. La Live Client Data API ne publie que l'or du joueur actif : les
 * totaux sont donc une ESTIMATION (cf. src/domain/livegold.ts), signalee par « ≈ ».
 * L'ecart central, lui, est nettement plus fiable : l'or de depart et l'or passif
 * s'annulent entre les deux equipes.
 */
function GoldWidget({
  snap,
  gameTime,
  config,
  onClose,
}: {
  snap: LiveSnapshot | null;
  gameTime: number | null;
  config: boolean;
  onClose?: () => void;
}) {
  const g = snap && gameTime !== null ? teamGold(snap.players, gameTime) : null;
  if (!g)
    return config ? (
      <Widget title="Or des équipes" onClose={onClose}>
        <span className="ov-wait">En attente de partie</span>
      </Widget>
    ) : null;
  const side = g.diff > 0 ? "ahead" : g.diff < 0 ? "behind" : "";
  return (
    <div className="ov-gold-box" title="Estimation : l'API locale ne publie pas l'or des autres joueurs">
      <span className="ov-gold-mine">
        <span className="ov-approx">≈</span>
        {kgold(g.mine)}
      </span>
      <span className={`ov-gold-diff ${side}`}>
        {kdiff(g.diff)}
        <i className="ov-gold-coin" aria-hidden="true" />
      </span>
      <span className="ov-gold-theirs">
        <span className="ov-approx">≈</span>
        {kgold(g.theirs)}
      </span>
      {onClose && (
        <button type="button" className="ov-close" aria-label="Masquer l'or des équipes" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Probabilite de victoire. Frequence observee sur les parties collectees par NEX pour la
 * tranche de temps et l'ecart d'or courants (cf. src/domain/winprob.ts) : ni modele, ni
 * extrapolation. Deux raisons de n'afficher aucun chiffre, et le widget le dit :
 * la situation n'est pas assez observee, ou le temps de jeu sort des tranches couvertes.
 */
function WinProbWidget({
  snap,
  gameTime,
  grid,
  config,
  onClose,
}: {
  snap: LiveSnapshot | null;
  gameTime: number | null;
  grid: WinProbDto | null;
  config: boolean;
  onClose?: () => void;
}) {
  const gold = snap && gameTime !== null ? teamGold(snap.players, gameTime) : null;
  const answer = gold && gameTime !== null ? winProbability(grid, gameTime, gold.diff) : null;
  if (!answer)
    return config || gold ? (
      <Widget title="Probabilité de victoire" onClose={onClose}>
        <span className="ov-wait">{grid ? "Situation pas encore assez observée" : "En attente de partie"}</span>
      </Widget>
    ) : null;
  const mine = Math.round(answer.p * 100);
  return (
    <Widget title="Probabilité de victoire" onClose={onClose}>
      <div className="ov-wp">
        <span className="ov-wp-side mine">
          <b>{mine}</b>%<em>ton équipe</em>
        </span>
        <span className="ov-wp-side theirs">
          <b>{100 - mine}</b>%<em>adverse</em>
        </span>
      </div>
      <div className="ov-wp-bar" aria-hidden="true">
        <i style={{ width: `${mine}%` }} />
      </div>
      <span className="ov-sub">
        {answer.games.toLocaleString("fr-FR")} situations observées · {answer.minute} min, écart ≈{answer.bucket > 0 ? "+" : ""}
        {answer.bucket}K
      </span>
    </Widget>
  );
}
