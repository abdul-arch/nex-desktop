// Data Studio : catalogue de mesures nommees, calculees sur les parties chargees du joueur.
//
// Memes regles que metrics.ts : remakes, parties < 5 min et modes hors Faille/ARAM exclus,
// valeurs absentes = null (jamais 0), agregats = ratios de sommes.
//
// Chaque mesure est une entree du catalogue : un libelle, ce qu'elle compte, sa valeur pour
// une partie et son agregat sur un lot de parties. L'interface n'en sait rien d'autre, ce
// qui permet d'en ajouter une sans la toucher.
import type { MatchDto } from "../platform/api";
import { goldDiffAt15 } from "./fromMatch";
import { MIN_VALID_DURATION_SEC } from "./metrics";

export interface StudioRow {
  id: string;
  startedAt: number;
  queue: MatchDto["queue"];
  champion: string;
  championId: number;
  role: string | null;
  win: boolean;
  minutes: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damage: number;
  damageTaken: number;
  vision: number;
  wardsPlaced: number;
  wardsKilled: number;
  controlWards: number;
  teamKills: number;
  teamDamage: number;
  goldDiff15: number | null;
  /** Champs que Riot ne fournit pas toujours : null quand la donnee manque. */
  soloKills: number | null;
  ccTime: number | null;
  timeDead: number | null;
  objectiveDamage: number | null;
  turretDamage: number | null;
  killingSpree: number | null;
  firstBlood: boolean | null;
  largestMultiKill: number;
  team: { dragon: number; baron: number; herald: number; horde: number; tower: number; inhibitor: number };
  enemy: { dragon: number; baron: number; herald: number; horde: number; tower: number; inhibitor: number };
}

export function toStudioRows(matches: MatchDto[], puuid: string): StudioRow[] {
  const out: StudioRow[] = [];
  for (const m of matches) {
    if (m.remake || m.durationSec < MIN_VALID_DURATION_SEC || m.queue === "arena" || m.queue === "other" || m.gameMode === "CHERRY") continue;
    const me = m.participants.find((p) => p.puuid === puuid);
    if (!me) continue;
    const mates = m.participants.filter((p) => p.teamId === me.teamId);
    const own = m.teams.find((t) => t.teamId === me.teamId)?.objectives;
    const opp = m.teams.find((t) => t.teamId !== me.teamId)?.objectives;
    const obj = (o: typeof own) => ({
      dragon: o?.dragon ?? 0,
      baron: o?.baron ?? 0,
      herald: o?.herald ?? 0,
      horde: o?.horde ?? 0,
      tower: o?.tower ?? 0,
      inhibitor: o?.inhibitor ?? 0,
    });
    out.push({
      id: m.id,
      startedAt: m.startedAt,
      queue: m.queue,
      champion: me.champion,
      championId: me.championId,
      role: me.position,
      win: me.win,
      minutes: m.durationSec / 60,
      kills: me.kills,
      deaths: me.deaths,
      assists: me.assists,
      cs: me.cs,
      gold: me.goldEarned,
      damage: me.damageToChampions,
      damageTaken: me.damageTaken,
      vision: me.visionScore,
      wardsPlaced: me.wardsPlaced,
      wardsKilled: me.wardsKilled,
      controlWards: me.controlWardsBought,
      teamKills: mates.reduce((a, p) => a + p.kills, 0),
      teamDamage: mates.reduce((a, p) => a + p.damageToChampions, 0),
      goldDiff15: goldDiffAt15(m, me),
      soloKills: me.soloKills,
      ccTime: me.ccTimeSec,
      timeDead: me.timeDeadSec,
      objectiveDamage: me.damageToObjectives,
      turretDamage: me.damageToTurrets,
      killingSpree: me.largestKillingSpree,
      firstBlood: me.firstBlood,
      largestMultiKill: me.largestMultiKill,
      team: obj(own),
      enemy: obj(opp),
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export type StudioCategory = "combat" | "lane" | "objectifs" | "vision" | "partie";

export const STUDIO_CATEGORIES: { key: StudioCategory; label: string }[] = [
  { key: "combat", label: "Combat" },
  { key: "lane", label: "Lane & farm" },
  { key: "objectifs", label: "Objectifs" },
  { key: "vision", label: "Vision" },
  { key: "partie", label: "Partie" },
];

export interface StudioStat {
  key: string;
  label: string;
  category: StudioCategory;
  /** Ce que la mesure compte, en une phrase. Affiche sous le titre. */
  help: string;
  higherIsBetter: boolean;
  format: (v: number) => string;
  /**
   * Format de l'ecart a la mediane, quand `format` est trop grossier pour lui. Un taux
   * affiche « 19 % » et « 20 % » : sans cela leur ecart reel (1,6 point) s'arrondirait a
   * « 2 % » et contredirait les deux nombres affiches.
   */
  formatDelta?: (v: number) => string;
  /** Valeur pour une partie, null si la donnee manque pour cette partie. */
  perGame: (r: StudioRow) => number | null;
  /** Agregat sur un lot : ratio de sommes quand c'est un taux, moyenne sinon. */
  aggregate: (rs: StudioRow[]) => number | null;
}

const sum = (rs: StudioRow[], f: (r: StudioRow) => number) => rs.reduce((a, r) => a + f(r), 0);
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
const pct = (v: number) => `${Math.round(v * 100)} %`;
/** Ecart entre deux taux, en points de pourcentage. */
const points = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")} pt`;
const one = (v: number) => v.toFixed(1);
const whole = (v: number) => Math.round(v).toLocaleString("fr-FR");

/** Moyenne des parties qui portent la donnee ; null si aucune ne la porte. */
function meanOf(rs: StudioRow[], f: (r: StudioRow) => number | null): number | null {
  const v = rs.map(f).filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export const STUDIO_STATS: StudioStat[] = [
  // ---------- Combat ----------
  {
    key: "kda",
    label: "KDA",
    category: "combat",
    help: "(éliminations + assistances) ÷ morts, sur l'ensemble des parties retenues.",
    higherIsBetter: true,
    format: (v) => v.toFixed(2),
    perGame: (r) => (r.kills + r.assists) / Math.max(1, r.deaths),
    aggregate: (rs) => ratio(sum(rs, (r) => r.kills + r.assists), Math.max(1, sum(rs, (r) => r.deaths))),
  },
  {
    key: "killParticipation",
    label: "Participation (KP)",
    category: "combat",
    help: "Part des éliminations de ton équipe où tu as tué ou aidé.",
    higherIsBetter: true,
    format: pct,
    formatDelta: points,
    perGame: (r) => ratio(r.kills + r.assists, r.teamKills),
    aggregate: (rs) => ratio(sum(rs, (r) => r.kills + r.assists), sum(rs, (r) => r.teamKills)),
  },
  {
    key: "killsPerGame",
    label: "Éliminations / partie",
    category: "combat",
    help: "Nombre d'éliminations par partie.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => r.kills,
    aggregate: (rs) => meanOf(rs, (r) => r.kills),
  },
  {
    key: "soloKills",
    label: "Solo kills",
    category: "combat",
    help: "Éliminations obtenues seul, sans aucune assistance. Riot ne la fournit pas sur toutes les parties.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => r.soloKills,
    aggregate: (rs) => meanOf(rs, (r) => r.soloKills),
  },
  {
    key: "deathsPer10",
    label: "Morts / 10 min",
    category: "combat",
    help: "Morts ramenées à dix minutes de jeu : comparable entre parties courtes et longues.",
    higherIsBetter: false,
    format: one,
    perGame: (r) => ratio(r.deaths * 10, r.minutes),
    aggregate: (rs) => ratio(sum(rs, (r) => r.deaths) * 10, sum(rs, (r) => r.minutes)),
  },
  {
    key: "timeDead",
    label: "Temps mort / partie",
    category: "combat",
    help: "Temps passé à attendre la réapparition, par partie.",
    higherIsBetter: false,
    format: mmss,
    perGame: (r) => r.timeDead,
    aggregate: (rs) => meanOf(rs, (r) => r.timeDead),
  },
  {
    key: "ccTime",
    label: "Contrôle de foule",
    category: "combat",
    help: "Secondes de contrôle infligées aux adversaires, par partie.",
    higherIsBetter: true,
    format: (v) => `${v.toFixed(1)} s`,
    perGame: (r) => r.ccTime,
    aggregate: (rs) => meanOf(rs, (r) => r.ccTime),
  },
  {
    key: "killingSpree",
    label: "Plus longue série",
    category: "combat",
    help: "Meilleure série d'éliminations sans mourir, par partie.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => r.killingSpree,
    aggregate: (rs) => meanOf(rs, (r) => r.killingSpree),
  },
  {
    key: "firstBlood",
    label: "Premier sang",
    category: "combat",
    help: "Part des parties où tu as porté le premier sang.",
    higherIsBetter: true,
    format: pct,
    formatDelta: points,
    perGame: (r) => (r.firstBlood === null ? null : r.firstBlood ? 1 : 0),
    aggregate: (rs) => meanOf(rs, (r) => (r.firstBlood === null ? null : r.firstBlood ? 1 : 0)),
  },
  {
    key: "damagePerMin",
    label: "Dégâts / min",
    category: "combat",
    help: "Dégâts aux champions par minute.",
    higherIsBetter: true,
    format: whole,
    perGame: (r) => ratio(r.damage, r.minutes),
    aggregate: (rs) => ratio(sum(rs, (r) => r.damage), sum(rs, (r) => r.minutes)),
  },
  {
    key: "damageShare",
    label: "Part des dégâts",
    category: "combat",
    help: "Part des dégâts aux champions de ton équipe qui vient de toi.",
    higherIsBetter: true,
    format: pct,
    formatDelta: points,
    perGame: (r) => ratio(r.damage, r.teamDamage),
    aggregate: (rs) => ratio(sum(rs, (r) => r.damage), sum(rs, (r) => r.teamDamage)),
  },
  {
    key: "damageTakenPerMin",
    label: "Dégâts subis / min",
    category: "combat",
    help: "Dégâts encaissés par minute. Élevé pour les tanks, pas forcément mauvais.",
    higherIsBetter: true,
    format: whole,
    perGame: (r) => ratio(r.damageTaken, r.minutes),
    aggregate: (rs) => ratio(sum(rs, (r) => r.damageTaken), sum(rs, (r) => r.minutes)),
  },

  // ---------- Lane & farm ----------
  {
    key: "csPerMin",
    label: "CS / min",
    category: "lane",
    help: "Sbires et monstres neutres tués par minute.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => ratio(r.cs, r.minutes),
    aggregate: (rs) => ratio(sum(rs, (r) => r.cs), sum(rs, (r) => r.minutes)),
  },
  {
    key: "goldPerMin",
    label: "Or / min",
    category: "lane",
    help: "Or gagné par minute.",
    higherIsBetter: true,
    format: whole,
    perGame: (r) => ratio(r.gold, r.minutes),
    aggregate: (rs) => ratio(sum(rs, (r) => r.gold), sum(rs, (r) => r.minutes)),
  },
  {
    key: "goldDiff15",
    label: "Écart d'or @15",
    category: "lane",
    help: "Avance ou retard d'or sur ton adversaire direct à 15:00. Existe seulement pour les parties chargées avec leur timeline.",
    higherIsBetter: true,
    format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`,
    perGame: (r) => r.goldDiff15,
    aggregate: (rs) => meanOf(rs, (r) => r.goldDiff15),
  },
  // ---------- Objectifs ----------
  {
    key: "objectiveDamage",
    label: "Dégâts aux objectifs",
    category: "objectifs",
    help: "Dégâts aux tours, inhibiteurs et monstres épiques, par partie.",
    higherIsBetter: true,
    format: whole,
    perGame: (r) => r.objectiveDamage,
    aggregate: (rs) => meanOf(rs, (r) => r.objectiveDamage),
  },
  {
    key: "turretDamage",
    label: "Dégâts aux tours",
    category: "objectifs",
    help: "Dégâts aux tourelles seules, par partie.",
    higherIsBetter: true,
    format: whole,
    perGame: (r) => r.turretDamage,
    aggregate: (rs) => meanOf(rs, (r) => r.turretDamage),
  },
  {
    key: "dragons",
    label: "Dragons de l'équipe",
    category: "objectifs",
    help: "Dragons pris par ton équipe, par partie.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => r.team.dragon,
    aggregate: (rs) => meanOf(rs, (r) => r.team.dragon),
  },
  {
    key: "barons",
    label: "Barons de l'équipe",
    category: "objectifs",
    help: "Barons Nashor pris par ton équipe, par partie.",
    higherIsBetter: true,
    format: (v) => v.toFixed(2),
    perGame: (r) => r.team.baron,
    aggregate: (rs) => meanOf(rs, (r) => r.team.baron),
  },
  {
    key: "grubs",
    label: "Larves du Néant",
    category: "objectifs",
    help: "Larves prises par ton équipe, par partie.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => r.team.horde,
    aggregate: (rs) => meanOf(rs, (r) => r.team.horde),
  },
  {
    key: "towers",
    label: "Tours de l'équipe",
    category: "objectifs",
    help: "Tourelles détruites par ton équipe, par partie.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => r.team.tower,
    aggregate: (rs) => meanOf(rs, (r) => r.team.tower),
  },

  // ---------- Vision ----------
  {
    key: "visionPerMin",
    label: "Score de vision / min",
    category: "vision",
    help: "Score de vision par minute : balises posées, détruites et temps de vision apportée.",
    higherIsBetter: true,
    format: (v) => v.toFixed(2),
    perGame: (r) => ratio(r.vision, r.minutes),
    aggregate: (rs) => ratio(sum(rs, (r) => r.vision), sum(rs, (r) => r.minutes)),
  },
  {
    key: "wardsPlacedPer10",
    label: "Balises posées / 10 min",
    category: "vision",
    help: "Balises posées, ramenées à dix minutes de jeu.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => ratio(r.wardsPlaced * 10, r.minutes),
    aggregate: (rs) => ratio(sum(rs, (r) => r.wardsPlaced) * 10, sum(rs, (r) => r.minutes)),
  },
  {
    key: "wardsKilledPer10",
    label: "Balises détruites / 10 min",
    category: "vision",
    help: "Balises adverses détruites, ramenées à dix minutes de jeu.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => ratio(r.wardsKilled * 10, r.minutes),
    aggregate: (rs) => ratio(sum(rs, (r) => r.wardsKilled) * 10, sum(rs, (r) => r.minutes)),
  },
  {
    key: "controlWards",
    label: "Balises de contrôle",
    category: "vision",
    help: "Balises de contrôle achetées, par partie.",
    higherIsBetter: true,
    format: one,
    perGame: (r) => r.controlWards,
    aggregate: (rs) => meanOf(rs, (r) => r.controlWards),
  },

  // ---------- Partie ----------
  {
    key: "duration",
    label: "Durée de partie",
    category: "partie",
    help: "Durée moyenne des parties retenues.",
    higherIsBetter: true,
    format: (v) => mmss(v * 60),
    perGame: (r) => r.minutes,
    aggregate: (rs) => meanOf(rs, (r) => r.minutes),
  },
  {
    key: "winRate",
    label: "Taux de victoire",
    category: "partie",
    help: "Part des parties retenues gagnées.",
    higherIsBetter: true,
    format: pct,
    formatDelta: points,
    perGame: (r) => (r.win ? 1 : 0),
    aggregate: (rs) => meanOf(rs, (r) => (r.win ? 1 : 0)),
  },
];

export function studioStat(key: string): StudioStat {
  return STUDIO_STATS.find((s) => s.key === key) ?? STUDIO_STATS[0];
}

/** Ligne de classement : une de tes mesures, pour un champion. */
export interface ChampionStat {
  champion: string;
  championId: number;
  games: number;
  wins: number;
  /** Valeur de la mesure sur ces parties, null si aucune ne porte la donnee. */
  value: number | null;
  inWins: number | null;
  inLosses: number | null;
}

/**
 * Classement de tes champions sur une mesure, du meilleur au moins bon selon le sens de
 * la mesure. Les champions dont aucune partie ne porte la donnee sont ecartes : une ligne
 * vide n'apprend rien.
 */
export function byChampion(rows: StudioRow[], stat: StudioStat, minGames = 1): ChampionStat[] {
  const groups = new Map<string, StudioRow[]>();
  for (const r of rows) {
    const list = groups.get(r.champion);
    if (list) list.push(r);
    else groups.set(r.champion, [r]);
  }
  const out: ChampionStat[] = [];
  for (const [champion, rs] of groups) {
    if (rs.length < minGames) continue;
    const value = stat.aggregate(rs);
    if (value === null) continue;
    out.push({
      champion,
      championId: rs[0].championId,
      games: rs.length,
      wins: rs.filter((r) => r.win).length,
      value,
      inWins: stat.aggregate(rs.filter((r) => r.win)),
      inLosses: stat.aggregate(rs.filter((r) => !r.win)),
    });
  }
  return out.sort((a, b) => ((b.value as number) - (a.value as number)) * (stat.higherIsBetter ? 1 : -1) || b.games - a.games);
}

/** Moyenne glissante sur `n` points (null tant que la fenetre n'est pas pleine). */
export function rolling(values: (number | null)[], n: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < n) return null;
    const w = values.slice(i + 1 - n, i + 1).filter((v): v is number => v !== null);
    return w.length === n ? w.reduce((a, b) => a + b, 0) / n : null;
  });
}

/** Export CSV (separateur « ; », lisible par Excel en francais). */
export function toCsv(rows: StudioRow[]): string {
  const head = [
    "match",
    "date",
    "file",
    "champion",
    "poste",
    "resultat",
    "duree_min",
    "kills",
    "morts",
    "assists",
    "cs",
    "or",
    "degats",
    "degats_subis",
    "vision",
    "balises_posees",
    "kp",
    "part_degats",
    "ecart_or_15",
    "solo_kills",
    "cc_secondes",
    "temps_mort",
    "degats_objectifs",
  ];
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const num = (v: number | null, d = 2) => (v === null ? "" : v.toFixed(d).replace(".", ","));
  const int = (v: number | null) => (v === null ? "" : String(Math.round(v)));
  const lines = rows.map((r) =>
    [
      r.id,
      new Date(r.startedAt).toISOString(),
      r.queue,
      r.champion,
      r.role ?? "",
      r.win ? "victoire" : "defaite",
      num(r.minutes, 1),
      String(r.kills),
      String(r.deaths),
      String(r.assists),
      String(r.cs),
      String(r.gold),
      String(r.damage),
      String(r.damageTaken),
      String(r.vision),
      String(r.wardsPlaced),
      num(ratio(r.kills + r.assists, r.teamKills), 3),
      num(ratio(r.damage, r.teamDamage), 3),
      int(r.goldDiff15),
      int(r.soloKills),
      int(r.ccTime),
      int(r.timeDead),
      int(r.objectiveDamage),
    ]
      .map(esc)
      .join(";"),
  );
  return [head.join(";"), ...lines].join("\n");
}
