// Lecture de la grille « probabilite de victoire » servie par le backend.
//
// CE QUE C'EST : la frequence observee sur les parties collectees par NEX. Pour une
// tranche de temps et un ecart d'or donnes, la part de ces situations suivie d'une
// victoire. Ce n'est pas un modele entraine, et rien n'est extrapole : une situation
// jamais assez observee ne recoit pas de reponse.
//
// DEUX LIMITES A GARDER EN TETE :
// 1. L'ecart d'or fourni en jeu est une ESTIMATION (cf. livegold.ts). Son erreur se
//    reporte sur la case choisie ; pres d'une frontiere, la case voisine aurait pu
//    sortir.
// 2. Les parties collectees sont des parties classees de haut niveau (Master et au-
//    dessus). La frequence observee vaut pour cette population, pas pour toutes.

import type { WinProbCellDto, WinProbDto } from "../platform/api";

/** Tranches servies par le backend (miroir de WINPROB_MINUTES). */
export const MINUTES = [5, 10, 15, 20, 25, 30, 35];
/** Au-dela de cet ecart a la tranche la plus proche, aucune reponse. */
export const MINUTE_TOLERANCE = 2.5;

export interface WinProbAnswer {
  /** Probabilite de victoire de ton equipe, entre 0 et 1. */
  p: number;
  /** Effectif de la case, a afficher avec la valeur. */
  games: number;
  minute: number;
  bucket: number;
}

/** Tranche de temps la plus proche, ou `null` hors de la plage couverte. */
export function nearestMinute(gameTimeSec: number): number | null {
  const m = gameTimeSec / 60;
  let best: number | null = null;
  for (const t of MINUTES) {
    if (best === null || Math.abs(m - t) < Math.abs(m - best)) best = t;
  }
  return best !== null && Math.abs(m - best) <= MINUTE_TOLERANCE ? best : null;
}

/** Ecart d'or -> numero de case (miroir de analytics::winprob_bucket). */
export function bucketOf(goldDiff: number, maxBucket: number): number {
  const b = Math.round(goldDiff / 1000);
  return Math.min(maxBucket, Math.max(-maxBucket, b));
}

/**
 * Probabilite de victoire de ton equipe, ou `null` quand la situation n'est pas
 * assez observee. Aucun repli sur une case voisine : mieux vaut ne rien dire.
 */
export function winProbability(grid: WinProbDto | null, gameTimeSec: number, goldDiff: number): WinProbAnswer | null {
  if (!grid || grid.cells.length === 0) return null;
  const minute = nearestMinute(gameTimeSec);
  if (minute === null) return null;
  const bucket = bucketOf(goldDiff, grid.maxBucket);
  const cell: WinProbCellDto | undefined = grid.cells.find((c) => c.minute === minute && c.bucket === bucket);
  if (!cell || cell.games <= 0) return null;
  return { p: cell.wins / cell.games, games: cell.games, minute, bucket };
}
