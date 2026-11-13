// Mesures d'un joueur calculees sur un echantillon de parties (pas sur la saison), et
// comparaison de rangs. Utilise par la rubrique Classements.
import { isCountable } from "./metrics";
import type { MatchSummary, Role } from "./types";

/** Nombre minimal de parties avec un poste connu pour annoncer un role principal. */
export const MIN_ROLE_GAMES = 5;

export interface PlayerSample {
  /** Parties retenues (ni remake, ni mode hors Faille/ARAM). */
  games: number;
  /** Role le plus joue, si l'echantillon suffit. */
  role: Role | null;
  /** Part des parties de l'echantillon jouees sur ce role (0-1). */
  roleShare: number | null;
  /** (K + A) / D sur l'ensemble de l'echantillon ; null sans partie. */
  kda: number | null;
  /** Champions les plus joues de l'echantillon (pas « les meilleurs »). */
  champions: { champion: string; games: number }[];
}

export function samplePlayer(matches: MatchSummary[]): PlayerSample {
  const counted = matches.filter(isCountable);
  const roles = new Map<Role, number>();
  const champs = new Map<string, number>();
  let k = 0;
  let d = 0;
  let a = 0;
  for (const m of counted) {
    if (m.role) roles.set(m.role, (roles.get(m.role) ?? 0) + 1);
    champs.set(m.champion, (champs.get(m.champion) ?? 0) + 1);
    k += m.kills;
    d += m.deaths;
    a += m.assists;
  }
  const withRole = [...roles.values()].reduce((x, y) => x + y, 0);
  const top = [...roles.entries()].sort((x, y) => y[1] - x[1])[0];
  const enough = withRole >= MIN_ROLE_GAMES && !!top;
  return {
    games: counted.length,
    role: enough ? top[0] : null,
    roleShare: enough ? top[1] / withRole : null,
    kda: counted.length ? (k + a) / Math.max(1, d) : null,
    champions: [...champs.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 4)
      .map(([champion, games]) => ({ champion, games })),
  };
}

const TIER_ORDER = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const DIVISION_ORDER = ["IV", "III", "II", "I"];

/**
 * Valeur de tri d'un rang : palier, puis division, puis LP. Un palier inferieur ne passe
 * jamais devant un palier superieur, quel que soit son nombre de LP. -1 : non classe.
 */
export function rankValue(rank: { tier: string; division: string | null; lp: number } | null | undefined): number {
  if (!rank) return -1;
  const t = TIER_ORDER.indexOf(rank.tier.toUpperCase());
  if (t < 0) return -1;
  const div = rank.division ? Math.max(0, DIVISION_ORDER.indexOf(rank.division)) : 0;
  // LP borne : au-dessus de Maitre il n'y a pas de division, les LP departagent sans limite utile.
  return t * 1_000_000 + div * 100_000 + Math.min(99_999, Math.max(0, rank.lp));
}
