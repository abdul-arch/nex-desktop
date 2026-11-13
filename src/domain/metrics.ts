// Metriques agregees, calculees uniquement a partir des parties chargees.
// Regles (cf. docs/METHODE_STATISTIQUE.md) :
// - les remakes et parties de duree invalide sont exclus ;
// - les ratios sont des ratios de sommes (pas des moyennes de ratios) ;
// - une metrique sans donnee renvoie null : l'interface affiche "—", jamais 0.
import type { MatchSummary } from "./types";
import { nexScore } from "./nexScore";

export const MIN_VALID_DURATION_SEC = 300;

/**
 * Partie retenue dans les statistiques : ni remake, ni duree invalide, ni mode hors
 * Faille/ARAM (Arena, URF... ont des regles qui faussent KP, CS ou part des degats).
 */
export function isCountable(m: MatchSummary): boolean {
  return !m.remake && m.queue !== "other" && Number.isFinite(m.durationSec) && m.durationSec >= MIN_VALID_DURATION_SEC;
}

export type MetricKey =
  | "kda"
  | "nexScore"
  | "killParticipation"
  | "csPerMin"
  | "damagePerMin"
  | "damageShare"
  | "goldDiffAt15"
  | "soloKills";

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  format: (v: number) => string;
  /** Plus haut = meilleur. */
  higherIsBetter: boolean;
  /** Valeur d'une partie isolee (pour la mini-courbe). */
  perMatch: (m: MatchSummary) => number | null;
  /** Valeur agregee sur un ensemble de parties. */
  aggregate: (ms: MatchSummary[]) => number | null;
  /** Unite de la variation affichee. */
  deltaUnit: "abs" | "pts";
  help: string;
}

const sum = (ms: MatchSummary[], f: (m: MatchSummary) => number) => ms.reduce((a, m) => a + f(m), 0);
const minutes = (m: MatchSummary) => m.durationSec / 60;

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function meanOf(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const fixed = (d: number) => (v: number) => v.toFixed(d);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}`;

export function kdaOf(k: number, d: number, a: number): number {
  // 0 mort : on divise par 1 (convention usuelle) ; l'interface signale "sans mort".
  return (k + a) / Math.max(1, d);
}

export const METRICS: MetricDef[] = [
  {
    key: "kda",
    label: "KDA",
    short: "KDA",
    format: fixed(1),
    higherIsBetter: true,
    perMatch: (m) => kdaOf(m.kills, m.deaths, m.assists),
    aggregate: (ms) =>
      ms.length ? kdaOf(sum(ms, (m) => m.kills), sum(ms, (m) => m.deaths), sum(ms, (m) => m.assists)) : null,
    deltaUnit: "abs",
    help: "(Éliminations + assistances) / morts, sommés sur la période. 0 mort : divisé par 1.",
  },
  {
    key: "nexScore",
    label: "Score NEX",
    short: "NEX",
    format: fixed(1),
    higherIsBetter: true,
    perMatch: (m) => nexScore(m).score,
    aggregate: (ms) => meanOf(ms.map((m) => nexScore(m).score)),
    deltaUnit: "abs",
    help: "Note 0–100 combinant KDA, participation, CS/min, part des dégâts et vision, par rapport à des repères par rôle. Méthode dans Paramètres › À propos.",
  },
  {
    key: "killParticipation",
    label: "Participation",
    short: "KP",
    format: pct,
    higherIsBetter: true,
    perMatch: (m) => ratio(m.kills + m.assists, m.teamKills),
    aggregate: (ms) => ratio(sum(ms, (m) => m.kills + m.assists), sum(ms, (m) => m.teamKills)),
    deltaUnit: "pts",
    help: "(Éliminations + assistances) / éliminations de l'équipe, sommées sur la période.",
  },
  {
    key: "csPerMin",
    label: "CS/min",
    short: "CSM",
    format: fixed(1),
    higherIsBetter: true,
    perMatch: (m) => ratio(m.cs, minutes(m)),
    aggregate: (ms) => ratio(sum(ms, (m) => m.cs), sum(ms, minutes)),
    deltaUnit: "abs",
    help: "Sbires et monstres neutres tués / minutes jouées.",
  },
  {
    key: "damagePerMin",
    label: "Dégâts/min",
    short: "DMG/min",
    format: (v) => Math.round(v).toString(),
    higherIsBetter: true,
    perMatch: (m) => ratio(m.damageToChampions, minutes(m)),
    aggregate: (ms) => ratio(sum(ms, (m) => m.damageToChampions), sum(ms, minutes)),
    deltaUnit: "abs",
    help: "Dégâts infligés aux champions / minutes jouées.",
  },
  {
    key: "damageShare",
    label: "Part des dégâts",
    short: "DMG %",
    format: pct,
    higherIsBetter: true,
    perMatch: (m) => ratio(m.damageToChampions, m.teamDamageToChampions),
    aggregate: (ms) => ratio(sum(ms, (m) => m.damageToChampions), sum(ms, (m) => m.teamDamageToChampions)),
    deltaUnit: "pts",
    help: "Dégâts aux champions / dégâts de l'équipe, sommés sur la période.",
  },
  {
    key: "goldDiffAt15",
    label: "Écart d'or @15",
    short: "GD@15",
    format: signed,
    higherIsBetter: true,
    perMatch: (m) => m.goldDiffAt15,
    aggregate: (ms) => meanOf(ms.map((m) => m.goldDiffAt15)),
    deltaUnit: "abs",
    help: "Or total du joueur moins celui de l'adversaire direct à 15:00 (timeline requise). Moyenne des parties disposant de la timeline.",
  },
  {
    key: "soloKills",
    label: "Solo kills",
    short: "SOLO",
    format: fixed(1),
    higherIsBetter: true,
    perMatch: (m) => m.soloKills,
    aggregate: (ms) => meanOf(ms.map((m) => m.soloKills)),
    deltaUnit: "abs",
    help: "Éliminations sans assistance alliée, moyenne par partie (timeline requise).",
  },
];

export interface MetricSummary {
  def: MetricDef;
  value: number | null;
  /** Variation : bloc recent vs bloc precedent de meme taille. null si echantillon insuffisant. */
  delta: number | null;
  /** Valeurs par partie, ordre chronologique, pour la mini-courbe. */
  series: number[];
  /** Nombre de parties ayant une valeur. */
  sampleSize: number;
  comparisonWindow: number;
}

/**
 * Resume d'une metrique. `matches` doit etre trie du plus recent au plus ancien.
 * La variation compare les `window` parties les plus recentes aux `window` precedentes ;
 * elle n'est calculee que si chaque bloc contient au moins 3 parties avec valeur.
 */
export function summarize(def: MetricDef, matches: MatchSummary[], window = 10): MetricSummary {
  const valid = matches.filter(isCountable);
  const withValue = valid.filter((m) => def.perMatch(m) !== null);
  const recent = withValue.slice(0, window);
  const previous = withValue.slice(window, window * 2);
  const value = def.aggregate(valid.filter((m) => def.perMatch(m) !== null));
  let delta: number | null = null;
  if (recent.length >= 3 && previous.length >= 3) {
    const a = def.aggregate(recent);
    const b = def.aggregate(previous);
    if (a !== null && b !== null) delta = def.deltaUnit === "pts" ? (a - b) * 100 : a - b;
  }
  const series = [...withValue]
    .reverse()
    .map((m) => def.perMatch(m))
    .filter((v): v is number => v !== null);
  return { def, value, delta, series, sampleSize: withValue.length, comparisonWindow: window };
}

export function winRate(wins: number, losses: number): number | null {
  return wins + losses > 0 ? wins / (wins + losses) : null;
}

export interface ChampionAggregate {
  champion: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

export function championAggregates(matches: MatchSummary[]): ChampionAggregate[] {
  const map = new Map<string, ChampionAggregate>();
  for (const m of matches.filter(isCountable)) {
    const a = map.get(m.champion) ?? { champion: m.champion, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
    a.games++;
    if (m.win) a.wins++;
    a.kills += m.kills;
    a.deaths += m.deaths;
    a.assists += m.assists;
    map.set(m.champion, a);
  }
  return [...map.values()].sort((x, y) => y.games - x.games || y.wins - x.wins);
}

export function roleDistribution(matches: MatchSummary[]) {
  const counted = matches.filter((m) => isCountable(m) && m.role);
  const roles = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
  return roles.map((role) => {
    const ms = counted.filter((m) => m.role === role);
    return {
      role,
      games: ms.length,
      share: counted.length ? ms.length / counted.length : 0,
      winRate: winRate(ms.filter((m) => m.win).length, ms.filter((m) => !m.win).length),
    };
  });
}
