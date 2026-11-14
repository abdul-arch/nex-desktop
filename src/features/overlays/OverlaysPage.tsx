import { LayoutGrid, Move, RotateCcw, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { errorMessage, platform } from "../../platform";
import type { Catalog, ChampionSpell, LiveSnapshot, WidgetId, WidgetLayout, WinProbDto } from "../../platform/api";
import { EXAMPLE_BUILD, EXAMPLE_GRID, EXAMPLE_SNAPSHOT } from "../../overlay/example";
// Capture de la Faille fournie par l'utilisateur. Decor uniquement : elle ne porte
// aucune donnee et ne change jamais, contrairement aux apercus qu'elle accueille.
import riftArt from "../../assets/rift.webp";
import { renderWidget, type WidgetInputs } from "../../overlay/render";
import { EmptyState } from "../../ui/primitives";
import { LayoutEditor } from "./LayoutEditor";
import { WIDGET_INFO } from "./widgets";

export function OverlaysPage() {
  const { settings, setSetting, notify } = useAppState();
  const client = useClient();
  const [layout, setLayout] = useState<WidgetLayout[]>([]);
  // Raccourcis qu'une autre application retenait au demarrage : sans cela, la fonction
  // concernee paraissait simplement cassee.
  const [failed, setFailed] = useState<string[]>([]);
  // Widget dont le panneau de reglages est ouvert.
  const [panel, setPanel] = useState<WidgetId | null>(null);
  // Apercus : instantane reel en partie, valeurs d'exemple sinon (carte marquee).
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
  // Sorts du champion de l'apercu, pour que la vignette du rappel de competence montre la
  // meme icone qu'en jeu.
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
    // Les apercus montrent l'etat d'attente plutot que rien : une carte vide
    // n'apprendrait pas a quoi sert le widget.
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

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <LayoutGrid aria-hidden="true" /> Overlays
        </h1>
        <p className="page-sub">Petits widgets par-dessus le jeu, déplaçables et masquables. Une seule fenêtre transparente, traversée par les clics.</p>
      </div>

      <div className="card card-pad" style={{ display: "grid", gap: 6 }}>
        <b>Pour déplacer les widgets en jeu</b>
        <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
          League doit être en <b>mode fenêtre sans bordure</b> (Options → Vidéo → Mode fenêtre). En plein écran exclusif, Windows interdit à toute
          application de passer au-dessus du jeu : l'overlay reste invisible et ne reçoit aucun clic. Ensuite, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>{" "}
          bascule en mode configuration, et le même raccourci en sort.
        </p>
        {failed.length > 0 && (
          <p className="neg" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
            Raccourci indisponible : {failed.join(", ")} — une autre application le détient déjà. Ferme-la, ou cette fonction restera sans effet.
          </p>
        )}
      </div>
      {!caps.windowControls ? (
        <div className="card">
          <EmptyState title="Overlay en jeu disponible dans l'application desktop" />
        </div>
      ) : (
        <>
          <section className="card card-pad ov-place">
            <div>
              <b>Placer les widgets par-dessus le jeu</b>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "var(--fs-sm)" }}>
                Ouvre l'overlay en mode configuration : tu attrapes chaque widget à la souris et tu le poses où tu veux, directement sur l'écran
                de jeu. En partie, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> fait la même chose sans quitter le jeu, et le même raccourci en sort.
              </p>
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => run(platform.overlayOpen(true))}>
              <Move /> Déplacer sur l'écran réel
            </button>
          </section>

          <section className="card card-pad overlay-actions">
            <button className="btn" onClick={() => run(platform.overlaySetMode(false))}>
              Verrouiller (mode jeu)
            </button>
            <button className="btn" onClick={() => run(platform.overlayClose())}>
              <X /> Fermer l'overlay
            </button>
            <button
              className="btn btn-ghost"
              onClick={() =>
                run(
                  platform.overlayLayoutReset().then((l) => {
                    setLayout(l);
                    notify("Disposition réinitialisée");
                  }),
                )
              }
            >
              <RotateCcw /> Réinitialiser
            </button>
            <span className="spacer" />
            <label className="check">
              <input type="checkbox" checked={settings.overlayAuto ?? true} onChange={(e) => setSetting("overlayAuto", e.target.checked)} /> Ouvrir automatiquement en partie
            </label>
          </section>
          <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "8px 2px 14px" }}>
            Raccourcis globaux : <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> mode configuration · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> afficher/masquer. Le jeu doit être en
            mode <b>fenêtré sans bordure</b> : une fenêtre ne peut pas s'afficher au-dessus du plein écran exclusif. État actuel :{" "}
            {client.state?.stage === "in_game" ? "partie en cours" : "aucune partie"}.
          </p>

          <details className="card card-pad" style={{ marginBottom: 14 }}>
            <summary className="panel-label" style={{ cursor: "pointer" }}>
              Placer depuis l'app (utile quand le jeu n'est pas lancé)
            </summary>
            <LayoutEditor layout={layout} onChange={update} />
          </details>

          {GROUPS.map(([label, ids]) => (
            <section key={label} className="ov-group">
              <div className="panel-label">{label}</div>
              <div className="ov-cards">
                {ids
                  .map((id) => layout.find((w) => w.id === id))
                  .filter((w): w is WidgetLayout => !!w)
                  .map((w) => (
                    <WidgetCard
                      key={w.id}
                      w={w}
                      inputs={preview}
                      featured={w.id === "winprob"}
                      live={live}

                      onToggle={(visible) => update({ ...w, visible })}
                      onOpen={() => setPanel(w.id)}
                    />
                  ))}
              </div>
            </section>
          ))}
          {panel &&
            (() => {
              const w = layout.find((x) => x.id === panel);
              return w ? <WidgetPanel w={w} onChange={update} onClose={() => setPanel(null)} /> : null;
            })()}

          <section className="card card-pad" style={{ marginTop: 14 }}>
            <div className="panel-label">Badges ARAM Mayhem</div>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: "var(--fs-sm)" }}>
              Notes NEX sur les cartes d'augments, placées sous le titre de chaque carte lue à l'écran. Les clics traversent les badges : cartes et relances
              restent utilisables.
            </p>
            <div className="widget-head">
              <label className="check">
                <input type="checkbox" checked={settings.mayhemBadges ?? true} onChange={(e) => setSetting("mayhemBadges", e.target.checked)} /> Afficher les badges
              </label>
              <label className="check" title="Lecture courte de l'écran après chaque montée de niveau en ARAM Mayhem. Jamais en mode Eco.">
                <input type="checkbox" checked={settings.mayhemAuto ?? true} onChange={(e) => setSetting("mayhemAuto", e.target.checked)} /> Lecture après une montée de niveau
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
            </div>
            <div className="overlay-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => run(platform.overlayOpen(false).then(() => platform.mayhemDemo(true)))}>
                Aperçu des badges (DÉMO)
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
              <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                L'aperçu utilise des données d'essai marquées « DÉMO », jamais appliquées à une vraie partie.
              </span>
            </div>
          </section>
          <section className="card card-pad" style={{ marginTop: 14 }}>
            <div className="panel-label">Règles</div>
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
              Les overlays sont des fenêtres Windows ordinaires : aucune injection dans le jeu, aucune lecture de sa mémoire, aucune information cachée. L'or
              des équipes et la probabilité de victoire ne sortent que de ce que le jeu publie lui-même (Live Client Data) et des parties collectées par NEX :
              l'or des autres joueurs n'étant pas publié, il est estimé et marqué d'un « ≈ », et une situation trop peu observée n'affiche aucun pourcentage.
              Chaque forme d'assistance devra être validée auprès de Riot avant une diffusion publique.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/** Regroupement des cartes, dans l'ordre d'affichage. */
const GROUPS: [string, WidgetId[]][] = [
  ["En jeu", ["gold", "winprob", "clock", "objectives"]],
  ["Rappels", ["build", "skills", "trinket"]],
];

/**
 * Cadrage de la capture par carte. Une seule image a charger, mais chaque carte en montre
 * une autre zone : l'echoppe, la fontaine, les tonneaux, le dallage. C'est ce qui evite
 * sept vignettes identiques.
 */
const CARD_FRAMING: Record<WidgetId, string> = {
  gold: "18% 28%",
  winprob: "52% 42%",
  clock: "64% 52%",
  objectives: "88% 14%",
  build: "13% 74%",
  skills: "40% 88%",
  trinket: "78% 76%",
};

/**
 * Carte d'un overlay : apercu du vrai widget, intitule, une ligne d'usage, un
 * interrupteur, et une roue dentee pour le reste. L'apercu est inerte (aucun clic ne le
 * traverse) et mis a l'echelle pour tenir dans la vignette.
 */
function WidgetCard({
  w,
  inputs,
  featured,
  live,
  onToggle,
  onOpen,
}: {
  w: WidgetLayout;
  inputs: WidgetInputs;
  featured: boolean;
  live: boolean;
  onToggle: (visible: boolean) => void;
  onOpen: () => void;
}) {
  const info = WIDGET_INFO[w.id];
  return (
    <article className={`ov-card ${featured ? "featured" : ""} ${w.visible ? "" : "off"}`}>
      <CardArt src={riftArt} position={CARD_FRAMING[w.id]} />
      <div className="ov-card-preview" aria-hidden="true">
        <div className="ov-card-scale">{renderWidget(w.id, inputs)}</div>
      </div>
      {!live && <span className="ov-card-tag">exemple</span>}
      <button type="button" className="ov-card-gear" onClick={onOpen} aria-label={`Réglages de ${info.name}`} title={`Réglages de ${info.name}`}>
        <Settings2 aria-hidden="true" />
      </button>
      <div className="ov-card-foot">
        <div className="ov-card-text">
          <b>{info.name}</b>
          <span>{info.summary}</span>
        </div>
        <label className="ov-switch" title={w.visible ? "Masquer cet overlay" : "Afficher cet overlay"}>
          <input type="checkbox" checked={w.visible} onChange={(e) => onToggle(e.target.checked)} />
          <i aria-hidden="true" />
          <span className="sr-only">{info.name}</span>
        </label>
      </div>
    </article>
  );
}

/**
 * Illustration de fond d'une carte.
 *
 * POURQUOI PAS `RemoteImg` : en cas d'echec, celui-ci affiche les initiales du sujet —
 * utile pour une vignette, absurde en fond de carte, ou cela ecrirait deux lettres en
 * grand au milieu. Ici un echec ne laisse rien : la carte retrouve son degrade, qui reste
 * la couche de base et s'affiche aussi avant le chargement et hors connexion.
 */
function CardArt({ src, position }: { src: string | null; position?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return null;
  return (
    <>
      <img className="ov-card-art" style={position ? { objectPosition: position } : undefined} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      <div className="ov-card-scrim" aria-hidden="true" />
    </>
  );
}

/**
 * Panneau de reglages d'un widget. Il porte tout ce qui ne tient pas sur la carte, y
 * compris les quatre champs de provenance : d'ou vient la donnee, a quelle frequence,
 * comment elle est calculee, et ce qui s'affiche quand elle manque.
 */
function WidgetPanel({ w, onChange, onClose }: { w: WidgetLayout; onChange: (w: WidgetLayout) => void; onClose: () => void }) {
  const info = WIDGET_INFO[w.id];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="ov-panel-back" onClick={onClose}>
      <aside className="ov-panel" role="dialog" aria-label={`Réglages de ${info.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="ov-panel-head">
          <b>{info.name}</b>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Fermer">
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="ov-panel-body">
          <label className="field">
            <span>Échelle {Math.round(w.scale * 100)} %</span>
            <input type="range" min={0.5} max={2} step={0.05} value={w.scale} onChange={(e) => onChange({ ...w, scale: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Opacité {Math.round(w.opacity * 100)} %</span>
            <input type="range" min={0.2} max={1} step={0.05} value={w.opacity} onChange={(e) => onChange({ ...w, opacity: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Affichage</span>
            <select className="select" value={w.mode} onChange={(e) => onChange({ ...w, mode: e.target.value as WidgetLayout["mode"] })}>
              <option value="always">Toujours</option>
              <option value="hold">Sur une touche</option>
            </select>
          </label>
          {w.mode === "hold" && (
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-xs)" }}>
              Visible uniquement tant que <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd> est maintenue.
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={w.locked} onChange={(e) => onChange({ ...w, locked: e.target.checked })} /> Verrouillé (non déplaçable en jeu)
          </label>
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
        </div>
      </aside>
    </div>
  );
}

