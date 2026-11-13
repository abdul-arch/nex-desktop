// Rendu des widgets d'overlay, partage par deux surfaces : la fenetre transparente
// (src/overlay/OverlayApp.tsx) et les apercus de la page de reglages
// (src/features/overlays/OverlaysPage.tsx).
//
// POURQUOI PARTAGE : un apercu dessine a part finirait par ne plus correspondre au widget
// reel des la premiere modification. Ici les deux surfaces appellent `renderWidget`, donc
// l'apercu ne peut pas mentir. Les composants ne tiennent aucun etat et ne lisent aucune
// plateforme : tout entre par `WidgetInputs`.

import { skillLabel } from "../domain/fromMatch";
import { kdiff, kgold, teamGold } from "../domain/livegold";
import { winProbability } from "../domain/winprob";
import { itemIcon, championIcon } from "../data/assets";
import type { Catalog, ChampionBuildDto, LiveSnapshot, WidgetId, WinProbDto } from "../platform/api";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const OBJ_NAMES: Record<string, string> = { dragon: "Dragon", elder: "Dragon ancestral", baron: "Baron Nashor" };

export interface WidgetInputs {
  snap: LiveSnapshot | null;
  /** Temps de jeu interpole, en secondes. */
  gameTime: number | null;
  catalog: Catalog | null;
  version: string | null;
  keys: "AZER" | "QWER";
  build: ChampionBuildDto | null;
  grid: WinProbDto | null;
  /**
   * `true` garde visible un widget qui n'aurait rien a afficher, en montrant son etat
   * d'attente plutot que `null`. Utilise par le mode configuration et par les apercus,
   * ou une carte vide n'apprendrait rien.
   */
  config: boolean;
  /** Absent sur un apercu : on ne ferme pas une vignette. */
  onClose?: (id: WidgetId) => void;
}

/** Rendu d'un widget. `null` signifie vraiment « rien a afficher ». */
export function renderWidget(id: WidgetId, i: WidgetInputs): React.ReactNode {
  const { snap, gameTime, catalog, version, keys, build, grid, config } = i;
  const me = snap?.players.find((p) => p.isActive) ?? null;
  const shut = i.onClose ? () => i.onClose!(id) : undefined;
  switch (id) {
    case "gold":
      return GoldWidget({ snap, gameTime, config, onClose: shut });
    case "winprob":
      return WinProbWidget({ snap, gameTime, grid, config, onClose: shut });
    case "clock":
      return (
        <Widget title="Partie" onClose={shut}>
          {gameTime === null ? (
            <span className="ov-wait">En attente de partie</span>
          ) : !me ? (
            // Mode spectateur : le jeu ne fournit pas de « joueur actif ».
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
      );
    case "objectives":
      return (
        <Widget title="Objectifs" onClose={shut}>
          {!snap || gameTime === null ? (
            <span className="ov-wait">En attente de partie</span>
          ) : snap.objectives.length === 0 ? (
            <span className="ov-wait">Aucun minuteur vérifiable</span>
          ) : (
            snap.objectives.map((o) => (
              <div key={o.kind} className="ov-row">
                <span>{OBJ_NAMES[o.kind] ?? o.kind}</span>
                <b className="num">{mmss(Math.max(0, o.nextSpawn - gameTime))}</b>
              </div>
            ))
          )}
        </Widget>
      );
    case "build":
      return BuildWidget({ build, owned: me?.items ?? [], catalog, version, live: !!snap, config, onClose: shut });
    case "skills":
      return SkillWidget({ snap, build, keys, config, onClose: shut, championKey: me?.championKey ?? null, version });
    case "trinket":
      return snap && me && snap.activeLevel >= 9 && me.items.includes(3340) ? (
        <Widget title="Trinket" onClose={shut}>
          <span>Niveau 9 : passer à la lentille d'oracle ?</span>
        </Widget>
      ) : config ? (
        <Widget title="Trinket">
          <span className="ov-wait">Rappel au niveau 9</span>
        </Widget>
      ) : null;
  }
}

export function Widget({ title, onClose, children }: { title: string; onClose?: () => void; children: React.ReactNode }) {
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
