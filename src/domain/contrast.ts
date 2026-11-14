// Rapport de contraste entre deux couleurs, et composition d'un voile sur un fond.
//
// POURQUOI : en posant une capture de jeu derriere un tableau, la colonne de reference en
// gris sourd est tombee a 3,13:1 sur les zones claires de l'image — sous le seuil de 4,5.
// A l'oeil sur une capture, ca passait. Seul le calcul l'a vu.
//
// Les formules sont celles de WCAG 2 : luminance relative apres linearisation sRGB, puis
// (L1 + 0,05) / (L2 + 0,05).

/** Seuil WCAG AA pour du texte courant. */
export const AA_TEXTE = 4.5;
/** Seuil WCAG AA pour du gros texte (>= 24 px, ou 19 px en gras). */
export const AA_GROS_TEXTE = 3;

export interface Rvb {
  r: number;
  g: number;
  b: number;
}

/** `#rgb` ou `#rrggbb`. Renvoie `null` plutot que de deviner sur une entree illisible. */
export function parseHex(hex: string): Rvb | null {
  const s = hex.trim().replace(/^#/, "");
  const court = /^[0-9a-fA-F]{3}$/.test(s);
  if (!court && !/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const plein = court ? s.replace(/./g, (c) => c + c) : s;
  return {
    r: parseInt(plein.slice(0, 2), 16),
    g: parseInt(plein.slice(2, 4), 16),
    b: parseInt(plein.slice(4, 6), 16),
  };
}

/** Linearisation sRGB d'une composante 0-255. */
function lineaire(v: number): number {
  const s = Math.min(Math.max(v, 0), 255) / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG, de 0 (noir) a 1 (blanc). */
export function luminance(c: Rvb): number {
  return 0.2126 * lineaire(c.r) + 0.7152 * lineaire(c.g) + 0.0722 * lineaire(c.b);
}

/** Rapport de contraste entre deux couleurs opaques, de 1 (identiques) a 21 (noir/blanc). */
export function contraste(a: Rvb, b: Rvb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [haut, bas] = la > lb ? [la, lb] : [lb, la];
  return (haut + 0.05) / (bas + 0.05);
}

/**
 * Couleur obtenue en posant `dessus` sur `dessous` avec une opacite donnee.
 *
 * Sert a calculer ce que le texte a reellement sous lui quand plusieurs couches
 * s'empilent : image a demi transparente sur un panneau, puis voile par-dessus.
 * L'opacite est bornee a [0, 1].
 */
export function composer(dessus: Rvb, dessous: Rvb, opacite: number): Rvb {
  const a = Math.min(Math.max(opacite, 0), 1);
  return {
    r: a * dessus.r + (1 - a) * dessous.r,
    g: a * dessus.g + (1 - a) * dessous.g,
    b: a * dessus.b + (1 - a) * dessous.b,
  };
}

/** Empile des couches de bas en haut : `composer` applique de proche en proche. */
export function empiler(fond: Rvb, couches: { couleur: Rvb; opacite: number }[]): Rvb {
  return couches.reduce((sous, c) => composer(c.couleur, sous, c.opacite), fond);
}
