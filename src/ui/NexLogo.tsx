import { useId } from "react";

// Le trace anime vit entierement dans la CSS (styles/intro.css) : les longueurs y sont
// ecrites une fois, mesurees sur la geometrie du dessin — perimetre de l'hexagone 150
// (six cotes de 25) et longueur du N 70,32 (21 + 28,32 + 21). Rien en style inline, pour
// ne pas avoir a arbitrer entre une animation CSS et un attribut de style.

/**
 * Logo NEX : hexagone arrondi, N evide (le fond se voit a travers).
 * Source vectorielle : docs/brand/nex-logo.svg (icones de l'app generees depuis ce dessin).
 *
 * `draw` fait apparaitre le trace puis le remplissage, pour l'animation de lancement.
 * L'animation porte sur les formes du masque deja presentes : pas de dessin en double,
 * donc aucun risque de decalage entre la version animee et la version finale.
 */
export function NexLogo({ size = 30, draw = false }: { size?: number; draw?: boolean }) {
  // Identifiants uniques : plusieurs logos peuvent coexister dans la page.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const grad = `nex-g-${uid}`;
  const mask = `nex-m-${uid}`;
  return (
    <svg className={`brand-mark${draw ? " brand-mark-draw" : ""}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a93ff" />
          <stop offset="1" stopColor="#5795ff" />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <polygon
            className="nex-hex"
            points="32,7 53.65,19.5 53.65,44.5 32,57 10.35,44.5 10.35,19.5"
            fill="#fff"
            stroke="#fff"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          <path
            className="nex-n"
            d="M22.5 42.5V21.5L41.5 42.5V21.5"
            fill="none"
            stroke="#000"
            strokeWidth="5.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <rect width="64" height="64" fill={`url(#${grad})`} mask={`url(#${mask})`} />
    </svg>
  );
}
