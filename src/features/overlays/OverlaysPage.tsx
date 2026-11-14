import { Clock3, Coins, Crosshair, Eye, Flag, LayoutGrid, Move, Percent, RotateCcw, Snowflake, Sparkles, Swords, Users, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { errorMessage, platform } from "../../platform";
import type { Catalog, ChampionSpell, LiveSnapshot, WidgetId, WidgetLayout, WinProbDto } from "../../platform/api";
import { EXAMPLE_BUILD, EXAMPLE_COUNTERS, EXAMPLE_GRID, EXAMPLE_SNAPSHOT } from "../../overlay/example";
// Capture de la Faille fournie par l'utilisateur. Decor uniquement : elle ne porte
// aucune donnee et ne change jamais, contrairement aux apercus qu'elle accueille.
import riftArt from "../../assets/rift.webp";
import { renderWidget, type WidgetInputs } from "../../overlay/render";
import { EmptyState } from "../../ui/primitives";
import { LayoutEditor } from "./LayoutEditor";
import { WIDGET_INFO } from "./widgets";

/**
 * Un module de la page : soit un widget place sur l'ecran (identifiant persistant de
 * `WidgetLayout`), soit une fonction qui n'est pas un widget deplacable — les badges
 * ARAM Mayhem et l'analyse de l'ecran de chargement. Les deux familles partagent la
 * meme colonne, mais pas les memes reglages.
 */
type ModuleId = WidgetId | "mayhem" | "loading";

type Phase = "En jeu" | "Sélection des champions" | "Écran de chargement" | "ARAM Mayhem";

interface ModuleDef {
  id: ModuleId;
  phase: Phase;
  name: string;
  summary: string;
  icon: LucideIcon;
}

/** Ordre d'affichage. Les identifiants des widgets ne changent pas : les reglages déjà
 *  enregistrés restent valides. */
const MODULES: ModuleDef[] = [
  { id: "objectives", phase: "En jeu", name: WIDGET_INFO.objectives.name, summary: WIDGET_INFO.objectives.summary, icon: Flag },
  { id: "clock", phase: "En jeu", name: WIDGET_INFO.clock.name, summary: WIDGET_INFO.clock.summary, icon: Clock3 },
  { id: "build", phase: "En jeu", name: WIDGET_INFO.build.name, summary: WIDGET_INFO.build.summary, icon: Swords },
  { id: "skills", phase: "En jeu", name: WIDGET_INFO.skills.name, summary: WIDGET_INFO.skills.summary, icon: Sparkles },
  { id: "gold", phase: "En jeu", name: WIDGET_INFO.gold.name, summary: WIDGET_INFO.gold.summary, icon: Coins },
  { id: "winprob", phase: "En jeu", name: WIDGET_INFO.winprob.name, summary: WIDGET_INFO.winprob.summary, icon: Percent },
  { id: "trinket", phase: "En jeu", name: WIDGET_INFO.trinket.name, summary: WIDGET_INFO.trinket.summary, icon: Eye },
  { id: "counters", phase: "Sélection des champions", name: WIDGET_INFO.counters.name, summary: WIDGET_INFO.counters.summary, icon: Crosshair },
  { id: "loading", phase: "Écran de chargement", name: "Analyse à l'écran de chargement", summary: "Les dix joueurs, leur rang et leurs LP.", icon: Users },
  { id: "mayhem", phase: "ARAM Mayhem", name: "Badges et optimisations", summary: "Tes repères au moment de choisir.", icon: Snowflake },
];

const PHASES: Phase[] = ["En jeu", "Sélection des champions", "Écran de chargement", "ARAM Mayhem"];

/** Etat du client, en clair. Dit aussi quand la source est absente. */
const STAGE_TEXT: Record<string, string> = {
  absent: "Client fermé",
  home: "Aucune partie",
  lobby: "Salon",
  matchmaking: "Recherche de partie",
  champ_select: "Sélection des champions",
  loading: "Écran de chargement",
  in_game: "Partie en cours",
  post_game: "Fin de partie",
  reconnect: "Reconnexion",
};

/**
 * Cadrage de la capture par module. Une seule image a charger, mais chaque apercu en
 * montre une autre zone : l'echoppe, la fontaine, les tonneaux, le dallage.
 */
const FRAMING: Record<ModuleId, string> = {
  gold: "18% 28%",
  winprob: "52% 42%",
  clock: "64% 52%",
  objectives: "88% 14%",
  build: "13% 74%",
  skills: "40% 88%",
  trinket: "78% 76%",
  counters: "62% 18%",
  loading: "50% 30%",
  mayhem: "30% 55%",
};

export function OverlaysPage() {
  const { settings, setSetting, notify } = useAppState();
  const client = useClient();
  const [layout, setLayout] = useState<WidgetLayout[]>([]);
  // Raccourcis qu'une autre application retenait au demarrage : sans cela, la fonction
  // concernee paraissait simplement cassee.
  const [failed, setFailed] = useState<string[]>([]);
  const [selected, setSelected] = useState<ModuleId>("objectives");
  const [helpOpen, setHelpOpen] = useState(false);
  // Apercus : instantane reel en partie, valeurs d'exemple sinon (apercu marque).
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [grid, setGrid] = useState<WinProbDto | null>(null);
  const [spells, setSpells] = useState<ChampionSpell[]>([]);
  const caps = platform.capabilities;

  useEffect(() => {
    let off: (() => void) | undefined;
    platform.overlayLayoutGet().then(setLayout).catch(() => {});
    platform.appInfo().then((i) => setFailed(i.failedShortcuts ?? [])).catch(() => {});
    platform.on<WidgetLayout[]>("overlay://layout", setLayout).then((o) => (off = o));
    platform.staticCatalog().then(setCatalog).catch(() => {});
    platform.staticDataVersion().then((v) => setVersion(v.version)).catch(() => {});
    platform.statsWinprob().then(setGrid).catch(() => setGrid(null));
    platform.liveSnapshot().then(setSnap).catch(() => setSnap(null));
    return () => off?.();
  }, []);

  // Une partie en cours remplace les valeurs d'exemple par la realite.
  const live = !!snap;
  const previewChamp = (snap ?? EXAMPLE_SNAPSHOT).players.find((p) => p.isActive)?.championKey ?? null;
  useEffect(() => {
    if (!previewChamp) return;
    let alive = true;
    platform
      .championInfo(previewChamp)
      .then((c) => alive && setSpells(c.spells))
      .catch(() => alive && setSpells([]));
    return () => {
      alive = false;
    };
  }, [previewChamp]);

  const preview: WidgetInputs = {
    snap: snap ?? EXAMPLE_SNAPSHOT,
    gameTime: (snap ?? EXAMPLE_SNAPSHOT).gameTime,
    catalog,
    version,
    keys: settings.abilityKeys,
    build: EXAMPLE_BUILD,
    spells,
    grid: live ? grid : EXAMPLE_GRID,
    counters: EXAMPLE_COUNTERS,
    // L'apercu montre l'etat d'attente plutot que rien : une vignette vide n'apprendrait
    // pas a quoi sert le module.
    config: true,
  };

  const update = async (w: WidgetLayout) => {
    setLayout((l) => l.map((x) => (x.id === w.id ? w : x)));
    try {
      setLayout(await platform.overlayLayoutSet(w));
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };
  const run = (p: Promise<unknown>) => p.catch((e) => notify(errorMessage(e), "error"));

  /** Activation d'un module, quelle que soit sa famille. */
  const isOn = (id: ModuleId): boolean => {
    if (id === "mayhem") return settings.mayhemBadges ?? true;
    if (id === "loading") return settings.overlayLoading ?? true;
    return layout.find((w) => w.id === id)?.visible ?? false;
  };
  const setOn = (id: ModuleId, on: boolean) => {
    if (id === "mayhem") return void setSetting("mayhemBadges", on);
    if (id === "loading") return void setSetting("overlayLoading", on);
    const w = layout.find((x) => x.id === id);
    if (w) void update({ ...w, visible: on });
  };

  const counts = useMemo(() => {
    const m = new Map<Phase, [number, number]>();
    for (const p of PHASES) {
      const mods = MODULES.filter((x) => x.phase === p);
      m.set(p, [mods.filter((x) => isOn(x.id)).length, mods.length]);
    }
    return m;
    // Recalcule quand une activation change, d'ou qu'elle vienne.
  }, [layout, settings.mayhemBadges, settings.overlayLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = MODULES.find((m) => m.id === selected)!;
  const stage = client.state?.stage ?? "absent";

  if (!caps.windowControls) {
    return (
      <div className="page">
        <div className="page-head">
          <h1 className="page-title">
            <LayoutGrid aria-hidden="true" /> Overlays
          </h1>
        </div>
        <div className="card">
          <EmptyState title="Overlay en jeu disponible dans l'application desktop" />
        </div>
      </div>
    );
  }

  return (
    <div className="page ovx">
      {/* En-tete : etat reel du client, action principale, commandes secondaires. */}
      <header className="ovx-head card card-pad">
        <div className="ovx-head-title">
          <h1 className="page-title">
            <LayoutGrid aria-hidden="true" /> Overlays
          </h1>
          <span className={`ovx-stage ${stage === "in_game" || stage === "loading" ? "live" : ""}`}>{STAGE_TEXT[stage] ?? stage}</span>
        </div>
        <div className="ovx-head-actions">
          <button className="btn btn-primary" onClick={() => run(platform.overlayOpen(true))}>
            <Move /> Placer sur l'écran
          </button>
          <button className="btn btn-sm" onClick={() => run(platform.overlaySetMode(false))}>
            Verrouiller
          </button>
          <button className="btn btn-sm" onClick={() => run(platform.overlayClose())}>
            <X /> Fermer
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() =>
              run(
                platform.overlayLayoutReset().then((l) => {
                  setLayout(l);
                  notify("Positions réinitialisées");
                }),
              )
            }
          >
            <RotateCcw /> Tout réinitialiser
          </button>
          <label className="check">
            <input type="checkbox" checked={settings.overlayAuto ?? true} onChange={(e) => setSetting("overlayAuto", e.target.checked)} /> Ouvrir en partie
          </label>
          <button className="btn btn-sm btn-ghost" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}>
            Aide et raccourcis
          </button>
        </div>
      </header>

      {helpOpen && (
        <section className="card card-pad ovx-help">
          <p>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> entre et sort du mode configuration · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> affiche ou masque
            les overlays · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd> maintenue affiche les modules réglés « sur une touche ».
          </p>
          <p className="muted">
            Place League en <b>mode fenêtré sans bordure</b> (Options → Vidéo → Mode fenêtre). C'est la configuration que NEX vise et teste ; en plein écran
            exclusif, l'affichage par-dessus le jeu n'est pas garanti par notre implémentation.
          </p>
          <p className="muted">
            Les overlays sont des fenêtres Windows ordinaires : aucune injection dans le jeu, aucune lecture de sa mémoire, aucune information cachée.
            L'or des autres joueurs n'étant pas publié par le jeu, il est estimé et marqué d'un « ≈ » ; une situation trop peu observée n'affiche aucun
            pourcentage.
          </p>
          {failed.length > 0 && (
            <p className="neg">
              Raccourci indisponible : {failed.join(", ")} — une autre application le détient déjà. Ferme-la, ou cette fonction restera sans effet.
            </p>
          )}
        </section>
      )}

      <div className="ovx-body">
        {/* Colonne des modules, groupes par phase, avec compteur d'activation. */}
        <nav className="ovx-nav card" aria-label="Modules d'overlay">
          {PHASES.map((p) => {
            const [on, total] = counts.get(p) ?? [0, 0];
            return (
              <div key={p} className="ovx-group">
                <div className="ovx-group-head">
                  <span>{p}</span>
                  <span className="ovx-count">
                    {on} sur {total}
                  </span>
                </div>
                {MODULES.filter((m) => m.phase === p).map((m) => (
                  <ModuleRow key={m.id} def={m} selected={selected === m.id} on={isOn(m.id)} onSelect={() => setSelected(m.id)} onToggle={(v) => setOn(m.id, v)} />
                ))}
              </div>
            );
          })}
          <div className="ovx-group ovx-global">
            <div className="ovx-group-head">
              <span>Tous les overlays</span>
            </div>
            <label className="field" title="Opacité du fond des panneaux. Le minimum est 65 % : en dessous, le texte cesse d'être lisible sur une scène de jeu claire.">
              <span>Fond {settings.overlayBackground ?? 86} %</span>
              <input
                type="range"
                min={65}
                max={100}
                step={2}
                value={settings.overlayBackground ?? 86}
                onChange={(e) => setSetting("overlayBackground", Number(e.target.value))}
              />
            </label>
            <label className="check" title="Aligne sur les bords, les axes centraux et les autres widgets. Maj enfoncée pour un placement libre.">
              <input type="checkbox" checked={settings.overlaySnap ?? true} onChange={(e) => setSetting("overlaySnap", e.target.checked)} /> Magnétisme au
              déplacement
            </label>
          </div>
        </nav>

        <section className="ovx-main card">
          <div className="ovx-main-head">
            <div>
              <h2>{def.name}</h2>
              <p className="muted">{def.summary}</p>
            </div>
            <label className="ov-switch" title={isOn(def.id) ? "Désactiver" : "Activer"}>
              <input type="checkbox" checked={isOn(def.id)} onChange={(e) => setOn(def.id, e.target.checked)} />
              <i aria-hidden="true" />
              <span className="sr-only">{def.name}</span>
            </label>
          </div>

          <div className="ovx-preview">
            <img className="ovx-preview-art" src={riftArt} alt="" style={{ objectPosition: FRAMING[def.id] }} />
            <div className="ovx-preview-scrim" aria-hidden="true" />
            {!live && <span className="ov-card-tag">{def.id === "mayhem" ? "DÉMO" : "exemple"}</span>}
            <div className="ovx-preview-inner" aria-hidden="true">
              {def.id === "mayhem" || def.id === "loading" ? <NonWidgetPreview id={def.id} /> : renderWidget(def.id, preview)}
            </div>
          </div>

          <div className="ovx-settings">
            <div>
              <div className="panel-label">Réglages</div>
              {def.id === "mayhem" ? (
                <MayhemSettings />
              ) : def.id === "loading" ? (
                <LoadingSettings />
              ) : (
                <WidgetSettings
                  w={layout.find((w) => w.id === def.id)}
                  onChange={update}
                  onResetPosition={() =>
                    run(
                      platform.overlayLayoutReset(def.id).then((l) => {
                        setLayout(l);
                        notify(`Position de « ${def.name} » réinitialisée`);
                      }),
                    )
                  }
                />
              )}
            </div>
            <div>
              <div className="panel-label">Sur votre écran</div>
              {def.id === "mayhem" || def.id === "loading" ? (
                <p className="muted ovx-note">
                  Ce module n'est pas un widget déplaçable : sa place est imposée par ce qu'il annote — les cartes d'augments pour les badges, les dix
                  emplacements de joueur pour l'écran de chargement.
                </p>
              ) : (
                <LayoutEditor layout={layout} onChange={update} snap={settings.overlaySnap ?? true} />
              )}
            </div>
          </div>

          <details className="ovx-source">
            <summary>D'où vient cette donnée</summary>
            <ModuleSource id={def.id} />
          </details>
        </section>
      </div>
    </div>
  );
}

/**
 * Ligne de la colonne. L'interrupteur et la selection sont deux interactions distinctes :
 * activer un module ne doit pas faire changer de panneau sous les doigts.
 */
function ModuleRow({
  def,
  selected,
  on,
  onSelect,
  onToggle,
}: {
  def: ModuleDef;
  selected: boolean;
  on: boolean;
  onSelect: () => void;
  onToggle: (on: boolean) => void;
}) {
  const Icon = def.icon;
  return (
    <div className={`ovx-row ${selected ? "selected" : ""}`}>
      <button type="button" className="ovx-row-main" onClick={onSelect} aria-current={selected ? "true" : undefined}>
        <Icon aria-hidden="true" />
        <span>
          <b>{def.name}</b>
          <em>{def.summary}</em>
        </span>
      </button>
      <label className="ov-switch sm" title={on ? "Désactiver" : "Activer"} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <i aria-hidden="true" />
        <span className="sr-only">{def.name}</span>
      </label>
    </div>
  );
}

/** Reglages d'un widget deplacable. */
function WidgetSettings({ w, onChange, onResetPosition }: { w: WidgetLayout | undefined; onChange: (w: WidgetLayout) => void; onResetPosition: () => void }) {
  if (!w) return <p className="muted ovx-note">Disposition non chargée.</p>;
  return (
    <div className="ovx-fields">
      <label className="field">
        <span>Taille {Math.round(w.scale * 100)} %</span>
        <input type="range" min={0.5} max={2} step={0.05} value={w.scale} onChange={(e) => onChange({ ...w, scale: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Opacité {Math.round(w.opacity * 100)} %</span>
        <input type="range" min={0.2} max={1} step={0.05} value={w.opacity} onChange={(e) => onChange({ ...w, opacity: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Mode d'affichage</span>
        <select className="select" value={w.mode} onChange={(e) => onChange({ ...w, mode: e.target.value as WidgetLayout["mode"] })}>
          <option value="always">Toujours</option>
          <option value="hold">Sur une touche</option>
        </select>
      </label>
      {w.mode === "hold" && (
        <p className="muted ovx-note">
          Visible tant que <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd> est maintenue.
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={w.locked} onChange={(e) => onChange({ ...w, locked: e.target.checked })} /> Verrouillé (non déplaçable en jeu)
      </label>
      <div className="overlay-actions">
        <button className="btn btn-sm btn-ghost" onClick={onResetPosition}>
          <RotateCcw /> Réinitialiser la position
        </button>
      </div>
    </div>
  );
}

/** Reglages du panneau de l'ecran de chargement. */
function LoadingSettings() {
  return (
    <p className="muted ovx-note">
      Le panneau lit la composition dans le client local, sans aucun appel à Riot, puis demande le rang des dix joueurs. Il disparaît dès que la partie
      commence : l'overlay en jeu prend le relais.
    </p>
  );
}

/** Reglages des badges ARAM Mayhem : tous conserves depuis l'ancienne page. */
function MayhemSettings() {
  const { settings, setSetting, notify } = useAppState();
  const run = (p: Promise<unknown>) => p.catch((e) => notify(errorMessage(e), "error"));
  return (
    <div className="ovx-fields">
      <label className="check" title="Lecture courte de l'écran après chaque montée de niveau en ARAM Mayhem. Jamais en mode Eco.">
        <input type="checkbox" checked={settings.mayhemAuto ?? true} onChange={(e) => setSetting("mayhemAuto", e.target.checked)} /> Lecture après une montée
        de niveau
        {settings.ecoMode && <span className="muted"> (inactive en mode Eco)</span>}
      </label>
      <label className="field">
        <span>Position {((settings.mayhemBadgeOffset ?? 118) / 10).toFixed(1)}× titre</span>
        <input type="range" min={40} max={200} step={2} value={settings.mayhemBadgeOffset ?? 118} onChange={(e) => setSetting("mayhemBadgeOffset", Number(e.target.value))} />
      </label>
      <label className="field">
        <span>Taille {settings.mayhemBadgeScale ?? 100} %</span>
        <input type="range" min={50} max={200} step={5} value={settings.mayhemBadgeScale ?? 100} onChange={(e) => setSetting("mayhemBadgeScale", Number(e.target.value))} />
      </label>
      <label className="field">
        <span>Opacité {settings.mayhemBadgeOpacity ?? 95} %</span>
        <input type="range" min={30} max={100} step={5} value={settings.mayhemBadgeOpacity ?? 95} onChange={(e) => setSetting("mayhemBadgeOpacity", Number(e.target.value))} />
      </label>
      <div className="overlay-actions">
        <button className="btn btn-sm" onClick={() => run(platform.overlayOpen(false).then(() => platform.mayhemDemo(true)))}>
          Aperçu DÉMO
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => run(platform.mayhemDemo(false))}>
          Retirer l'aperçu
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            setSetting("mayhemBadgeOffset", 118);
            setSetting("mayhemBadgeScale", 100);
            setSetting("mayhemBadgeOpacity", 95);
          }}
        >
          <RotateCcw /> Valeurs par défaut
        </button>
      </div>
      <p className="muted ovx-note">
        L'aperçu utilise des données d'essai marquées « DÉMO », jamais appliquées à une vraie partie. Les clics traversent les badges : cartes et relances
        restent utilisables.
      </p>
    </div>
  );
}

/** Apercu des deux modules qui ne sont pas des widgets deplacables. */
function NonWidgetPreview({ id }: { id: "mayhem" | "loading" }) {
  if (id === "mayhem") {
    return (
      <div className="ov-widget-box">
        <div className="ov-head">
          <span className="ov-title">Badges ARAM Mayhem</span>
        </div>
        <span className="ov-sub">Une note NEX sous le titre de chaque carte d'augment lue à l'écran.</span>
      </div>
    );
  }
  return (
    <div className="ov-widget-box">
      <div className="ov-head">
        <span className="ov-title">Écran de chargement</span>
      </div>
      <span className="ov-sub">Dix cartes : champion, pseudo, rang et bilan.</span>
    </div>
  );
}

/** Provenance de la donnee : les quatre champs, ou l'equivalent pour les deux modules
 *  qui ne sont pas des widgets. */
function ModuleSource({ id }: { id: ModuleId }) {
  if (id === "mayhem") {
    return (
      <dl className="kv widget-kv">
        <dt>Source</dt>
        <dd>Lecture de l'écran pendant la sélection d'augments, et notes NEX du catalogue Mayhem.</dd>
        <dt>Si absent</dt>
        <dd>Aucun badge si la carte n'est pas reconnue. Jamais de note inventée.</dd>
      </dl>
    );
  }
  if (id === "loading") {
    return (
      <dl className="kv widget-kv">
        <dt>Source</dt>
        <dd>Client local pour la composition et les pseudos ; API Riot pour le rang, un appel par joueur, en cache deux minutes.</dd>
        <dt>Si absent</dt>
        <dd>« rang en lecture… », « rang indisponible » ou « non classé » — trois états distincts, jamais substitués l'un à l'autre.</dd>
      </dl>
    );
  }
  const info = WIDGET_INFO[id];
  return (
    <dl className="kv widget-kv">
      <dt>Source</dt>
      <dd>{info.source}</dd>
      <dt>Fréquence</dt>
      <dd>{info.frequency}</dd>
      <dt>Calcul</dt>
      <dd>{info.transform}</dd>
      <dt>Si absent</dt>
      <dd>{info.missing}</dd>
    </dl>
  );
}
