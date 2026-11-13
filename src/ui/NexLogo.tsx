import { useId } from "react";

/**
 * Logo NEX : hexagone arrondi, N evide (le fond se voit a travers).
 * Source vectorielle : docs/brand/nex-logo.svg (icones de l'app generees depuis ce dessin).
 */
export function NexLogo({ size = 30 }: { size?: number }) {
  // Identifiants uniques : plusieurs logos peuvent coexister dans la page.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const grad = `nex-g-${uid}`;
  const mask = `nex-m-${uid}`;
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a93ff" />
          <stop offset="1" stopColor="#5795ff" />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <polygon points="32,7 53.65,19.5 53.65,44.5 32,57 10.35,44.5 10.35,19.5" fill="#fff" stroke="#fff" strokeWidth="8" strokeLinejoin="round" />
          <path d="M22.5 42.5V21.5L41.5 42.5V21.5" fill="none" stroke="#000" strokeWidth="5.6" strokeLinecap="round" strokeLinejoin="round" />
        </mask>
      </defs>
      <rect width="64" height="64" fill={`url(#${grad})`} mask={`url(#${mask})`} />
    </svg>
  );
}
