// Compteur numerique anime : la valeur monte de 0 jusqu'a sa cible, vite au debut puis
// de plus en plus lentement.
//
// La valeur affichee se calcule a partir du temps ecoule, jamais par une suite de « +1 ».
// Une cible de 1 200 LP dure donc exactement aussi longtemps qu'une cible de 9, et la
// derniere image tombe sur la cible au lieu de s'en approcher.

/** Decelration douce : derivee maximale a t=0, nulle a t=1, donc aucun rebond. */
export function easeOutCubic(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - x) ** 3;
}

/**
 * Valeur a afficher apres `elapsedMs`. Rend exactement `target` des que la duree est
 * atteinte, et ne depasse jamais la cible en chemin.
 */
export function countValue(target: number, elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(target)) return 0;
  if (durationMs <= 0 || elapsedMs >= durationMs) return target;
  if (elapsedMs <= 0) return 0;
  const v = Math.round(target * easeOutCubic(elapsedMs / durationMs));
  // Arrondi vers le haut possible sur la derniere image : on borne.
  return target >= 0 ? Math.min(v, target) : Math.max(v, target);
}

/**
 * Largeur a reserver pour que rien ne bouge pendant le comptage : la cible a toujours au
 * moins autant de chiffres que les valeurs intermediaires, puisqu'on monte vers elle.
 */
export function digitsOf(target: number): number {
  return Math.max(1, String(Math.abs(Math.trunc(target))).length);
}
