// Aimantation pendant le deplacement d'un widget d'overlay.
//
// Les positions sont des fractions de l'ecran (0 = bord gauche ou haut, 1 = bord oppose),
// comme dans `WidgetLayout`. La meme regle sert a la miniature de la page Overlays et au
// deplacement reel par-dessus le jeu : une seule implementation, donc aucun ecart de
// comportement entre les deux.
//
// Maintenir Maj desactive l'aimantation, pour un placement libre au pixel pres.

/** Distance d'attraction, en fraction d'ecran. ~1,2 % fait 23 px sur 1920. */
export const SNAP_RANGE = 0.012;

/** Reperes fixes : bords et axe central. */
const GUIDES = [0, 0.5, 1];

/**
 * Valeur aimantee sur un axe. `others` porte les coordonnees des autres widgets, pour
 * qu'ils s'alignent entre eux. Renvoie la valeur inchangee si rien n'est assez proche.
 */
export function snapAxis(value: number, others: readonly number[] = [], range = SNAP_RANGE): number {
  let best = value;
  let bestGap = range;
  for (const target of [...GUIDES, ...others]) {
    const gap = Math.abs(value - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = target;
    }
  }
  return best;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Point aimante. `enabled` a `false` (Maj enfoncee, ou reglage desactive) renvoie le
 * point tel quel : l'appelant n'a pas a dupliquer ce test.
 */
export function snapPoint(p: Point, others: readonly Point[], enabled: boolean, range = SNAP_RANGE): Point {
  if (!enabled) return p;
  return {
    x: snapAxis(p.x, others.map((o) => o.x), range),
    y: snapAxis(p.y, others.map((o) => o.y), range),
  };
}
