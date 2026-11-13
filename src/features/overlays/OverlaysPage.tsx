import { LayoutGrid, Move, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { errorMessage, platform } from "../../platform";
import type { WidgetLayout } from "../../platform/api";
import { EmptyState } from "../../ui/primitives";
import { LayoutEditor } from "./LayoutEditor";
import { WIDGET_INFO } from "./widgets";

export function OverlaysPage() {
  const { settings, setSetting, notify } = useAppState();
  const client = useClient();
  const [layout, setLayout] = useState<WidgetLayout[]>([]);
  const caps = platform.capabilities;

  useEffect(() => {
    let off: (() => void) | undefined;
    platform.overlayLayoutGet().then(setLayout).catch(() => {});
    platform.on<WidgetLayout[]>("overlay://layout", setLayout).then((o) => (off = o));
    return () => off?.();
  }, []);

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
      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="panel-label">Disposition à l'écran</div>
        <LayoutEditor layout={layout} onChange={update} />
      </section>
      {!caps.windowControls ? (
        <div className="card">
          <EmptyState title="Overlay en jeu disponible dans l'application desktop" />
        </div>
      ) : (
        <>
          <section className="card card-pad overlay-actions">
            <button className="btn btn-primary" onClick={() => run(platform.overlayOpen(true))}>
              <Move /> Déplacer sur l'écran réel
            </button>
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

          <div className="widget-list">
            {layout.map((w) => {
              const info = WIDGET_INFO[w.id];
              return (
                <section key={w.id} className="card card-pad widget-row">
                  <div className="widget-head">
                    <label className="check" style={{ fontSize: "var(--fs-md)", color: "var(--text)", fontWeight: 600 }}>
                      <input type="checkbox" checked={w.visible} onChange={(e) => update({ ...w, visible: e.target.checked })} /> {info.name}
                    </label>
                    <span className="spacer" />
                    <label className="check">
                      <input type="checkbox" checked={w.locked} onChange={(e) => update({ ...w, locked: e.target.checked })} /> Verrouillé
                    </label>
                    <label className="field">
                      <span>Échelle {Math.round(w.scale * 100)} %</span>
                      <input type="range" min={0.5} max={2} step={0.05} value={w.scale} onChange={(e) => update({ ...w, scale: Number(e.target.value) })} />
                    </label>
                    <label className="field">
                      <span>Opacité {Math.round(w.opacity * 100)} %</span>
                      <input type="range" min={0.2} max={1} step={0.05} value={w.opacity} onChange={(e) => update({ ...w, opacity: Number(e.target.value) })} />
                    </label>
                    <label className="field">
                      <span>Affichage</span>
                      <select className="select" value={w.mode} onChange={(e) => update({ ...w, mode: e.target.value as WidgetLayout["mode"] })}>
                        <option value="always">Toujours</option>
                        <option value="hold">Sur une touche</option>
                      </select>
                    </label>
                  </div>
                  {w.mode === "hold" && (
                    <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "4px 0 0" }}>
                      Visible uniquement tant que <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Espace</kbd> est maintenue.
                    </p>
                  )}
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
                </section>
              );
            })}
          </div>
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
              Les overlays sont des fenêtres Windows ordinaires : aucune injection dans le jeu, aucune lecture de sa mémoire, aucune information cachée. Pas de
              probabilité de victoire ni d'avantage d'or estimé. Chaque forme d'assistance devra être validée auprès de Riot avant une diffusion publique.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
