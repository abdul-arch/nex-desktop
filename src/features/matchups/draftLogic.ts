// Logique pure du simulateur de draft : suggestions argumentees et profil de composition.
// Aucune probabilite de victoire : uniquement des statistiques historiques expliquees.
import type { ChampionStatDto, MatchupsDto } from "../../platform/api";

export const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

export interface Slot {
  championId: number | null;
  role: (typeof ROLES)[number];
}

export interface Suggestion {
  championId: number;
  score: number;
  reasons: string[];
  games: number;
  adjustedWinRate: number;
  laneAdvantage: { pp: number; games: number } | null;
}

/**
 * Score = (taux ajuste - 50 %) en points + avantage de ligne attenue par l'effectif :
 * avantage * n / (n + 10). L'avantage vient des matchups de l'adversaire de ligne :
 * si l'adversaire perd X pts contre un candidat, le candidat gagne X pts.
 */
export function suggest(
  tier: ChampionStatDto[],
  enemyMatchups: MatchupsDto | null,
  excluded: Set<number>,
  minGames: number,
  nameOf: (id: number) => string,
  limit = 5,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const c of tier) {
    if (excluded.has(c.championId) || c.games < minGames) continue;
    const base = (c.adjustedWinRate - 0.5) * 100;
    const reasons = [`${(c.adjustedWinRate * 100).toFixed(1)} % ajusté à ce poste (${c.games} parties)`];
    let lane: Suggestion["laneAdvantage"] = null;
    let bonus = 0;
    const m = enemyMatchups?.matchups.find((x) => x.opponentId === c.championId);
    if (m && m.games >= 3 && enemyMatchups) {
      lane = { pp: -m.deltaPp, games: m.games };
      bonus = lane.pp * (m.games / (m.games + 10));
      reasons.push(
        `${nameOf(enemyMatchups.championId)} fait ${m.deltaPp >= 0 ? "+" : "−"}${Math.abs(m.deltaPp).toFixed(1)} pts contre lui (${m.games} parties)`,
      );
    }
    out.push({ championId: c.championId, score: base + bonus, reasons, games: c.games, adjustedWinRate: c.adjustedWinRate, laneAdvantage: lane });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface CompositionProfile {
  champions: number;
  physicalShare: number | null;
  frontline: number;
  classes: Record<string, number>;
  notes: string[];
}

/** Profil indicatif a partir des notes Data Dragon (attaque/magie) et des classes. */
export function composition(team: { attack: number; magic: number; tags: string[] }[]): CompositionProfile {
  const classes: Record<string, number> = {};
  let atk = 0;
  let mag = 0;
  let frontline = 0;
  for (const c of team) {
    atk += c.attack;
    mag += c.magic;
    if (c.tags.includes("Tank")) frontline++;
    for (const t of c.tags) classes[t] = (classes[t] ?? 0) + 1;
  }
  const physicalShare = atk + mag > 0 ? atk / (atk + mag) : null;
  const notes: string[] = [];
  if (team.length >= 3 && physicalShare !== null) {
    if (physicalShare >= 0.72) notes.push("Dégâts très physiques : l'armure adverse sera efficace.");
    else if (physicalShare <= 0.35) notes.push("Dégâts très magiques : la résistance magique adverse sera efficace.");
  }
  if (team.length >= 4 && frontline === 0) notes.push("Aucun tank identifié : peu de première ligne.");
  if (team.length >= 4 && !classes.Marksman && !classes.Mage) notes.push("Peu de dégâts à distance.");
  return { champions: team.length, physicalShare, frontline, classes, notes };
}
