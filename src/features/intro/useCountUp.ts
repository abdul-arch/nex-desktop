import { useEffect, useRef, useState } from "react";
import { countValue } from "../../domain/countUp";

/**
 * Valeur affichee d'un compteur anime.
 *
 * La cible reste la donnee du compte : seule la valeur rendue ici bouge pendant
 * l'animation, et elle n'est jamais ecrite nulle part. Une cible deja comptee ne
 * repart pas de zero, donc ni un nouveau rendu ni un rafraichissement des donnees
 * ne relancent le compteur.
 *
 * `durationMs` a 0 affiche la valeur finale tout de suite : c'est le cas « reduire
 * les animations ».
 */
export function useCountUp(target: number | null, start: boolean, durationMs: number): number | null {
  const [shown, setShown] = useState<number | null>(null);
  const dejaCompte = useRef<number | null>(null);

  useEffect(() => {
    if (target === null || !start) return;
    if (dejaCompte.current === target || durationMs <= 0) {
      dejaCompte.current = target;
      setShown(target);
      return;
    }
    dejaCompte.current = target;
    let raf = 0;
    const depart = performance.now();
    const pas = (maintenant: number) => {
      const ecoule = maintenant - depart;
      setShown(countValue(target, ecoule, durationMs));
      if (ecoule < durationMs) raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(raf);
  }, [target, start, durationMs]);

  return shown;
}
