// Estimation de l'or des deux equipes a partir de la Live Client Data API.
//
// POURQUOI UNE ESTIMATION : l'API locale ne publie l'or que du joueur actif
// (`currentGold`), jamais celui des neuf autres. L'or des equipes affiche en jeu par
// d'autres outils est donc toujours reconstitue. On le reconstitue ici a partir de ce
// que l'API donne reellement pour les dix joueurs : CS, eliminations, assistances, poste.
//
// CE QUI EST COMPTE : or de depart, or passif, or des sbires et monstres, eliminations,
// assistances.
// CE QUI NE L'EST PAS, faute de donnee : primes de serie et de rachat, plaques de
// tourelle, tourelles, dragons / heraut / baron, objets revendus, or passif des objets
// (Collecteur, Piece eternelle...) et des runes.
//
// CONSEQUENCE : les TOTAUX sont approximatifs (quelques milliers d'or d'ecart possible).
// L'ECART entre les deux equipes est nettement plus fiable : l'or de depart et l'or passif
// sont identiques pour les dix joueurs et s'annulent exactement dans la soustraction. Il
// reste exposé aux plaques, tourelles et objectifs, qui peuvent valoir ~1000 or. C'est
// pour cette raison que l'affichage marque les totaux d'un « ≈ ».

import type { LivePlayer } from "../platform/api";

/** Or de depart (hors Marque du grand fleau, non observable). */
export const START_GOLD = 500;
/** Or passif : 2,04 or/s a partir de 1:50. */
export const PASSIVE_PER_SEC = 2.04;
export const PASSIVE_START_SEC = 110;
/**
 * Or moyen par sbire sur une vague de 6 sbires + 1 siege toutes les 3 vagues :
 * (3x21 + 3x14 + 60/3) / 6.33 ≈ 19,7. Sous-estime apres 15 min (sieges plus frequents
 * et plus riches).
 */
export const GOLD_PER_MINION = 20;
/**
 * Or moyen par monstre de jungle. Les camps valent plus par unite comptee que les sbires
 * (Gromp 80 pour 1 monstre, loups 115 pour 3). Applique au poste JUNGLE uniquement.
 */
export const GOLD_PER_MONSTER = 28;
/** Or de base d'une elimination, hors prime et hors serie. */
export const GOLD_PER_KILL = 300;
/** Or d'assistance usuel ; en pratique partage entre les assistants. */
export const GOLD_PER_ASSIST = 150;

const isJungle = (p: LivePlayer) => (p.position ?? "").toUpperCase() === "JUNGLE";

/** Or estime d'un joueur. `gameTime` en secondes. */
export function playerGold(p: LivePlayer, gameTime: number): number {
  const passive = Math.max(0, gameTime - PASSIVE_START_SEC) * PASSIVE_PER_SEC;
  const farm = p.cs * (isJungle(p) ? GOLD_PER_MONSTER : GOLD_PER_MINION);
  return START_GOLD + passive + farm + p.kills * GOLD_PER_KILL + p.assists * GOLD_PER_ASSIST;
}

export interface TeamGold {
  /** Or estime de l'equipe du joueur actif. */
  mine: number;
  /** Or estime de l'equipe adverse. */
  theirs: number;
  /** mine - theirs. Plus fiable que les totaux (cf. en-tete du fichier). */
  diff: number;
}

/**
 * Or estime des deux equipes, du point de vue du joueur actif.
 * `null` si les deux equipes ne sont pas identifiables (spectateur, mode sans equipes).
 */
export function teamGold(players: LivePlayer[], gameTime: number): TeamGold | null {
  const me = players.find((p) => p.isActive);
  if (!me) return null;
  const mineTeam = players.filter((p) => p.team === me.team);
  const theirTeam = players.filter((p) => p.team !== me.team);
  if (mineTeam.length === 0 || theirTeam.length === 0) return null;
  const sum = (list: LivePlayer[]) => list.reduce((a, p) => a + playerGold(p, gameTime), 0);
  const mine = sum(mineTeam);
  const theirs = sum(theirTeam);
  return { mine, theirs, diff: mine - theirs };
}

/** « 24.1K » pour 24 100. En dessous de 1000, le nombre brut. */
export function kgold(v: number): string {
  const n = Math.max(0, Math.round(v));
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`;
}

/** Ecart signe arrondi a la centaine : « +4.0K », « -800 », « 0 ». */
export function kdiff(v: number): string {
  const n = Math.round(v / 100) * 100;
  if (n === 0) return "0";
  return (n > 0 ? "+" : "-") + kgold(Math.abs(n));
}
