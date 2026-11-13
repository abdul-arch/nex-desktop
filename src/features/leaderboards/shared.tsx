// Petits elements communs aux classements et aux fiches de joueurs pro.
import { platformLabel } from "../../domain/riotId";
import type { Role } from "../../domain/types";
import { TIER_LABEL } from "../../ui/format";

const REGION_COLOR: Record<string, string> = {
  EUW1: "#3653b8",
  EUN1: "#3f7d3a",
  KR: "#b0661f",
  NA1: "#6b4bb8",
  BR1: "#2f6e52",
  LA1: "#8a5a1f",
  LA2: "#8a6a1f",
  TR1: "#a03a3a",
  JP1: "#a03a6b",
  OC1: "#1f7a8a",
};

export function RegionTag({ plat }: { plat: string }) {
  return (
    <span className="lb-region" style={{ background: REGION_COLOR[plat] ?? "#3a3d4d" }}>
      {platformLabel(plat)}
    </span>
  );
}

export const fr = (n: number) => n.toLocaleString("fr-FR");
export const kdaText = (v: number | null | undefined) =>
  v == null ? null : v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const APEX = ["MASTER", "GRANDMASTER", "CHALLENGER"];

/** « Grand Maître », « Diamant II »… (pas de division au-dela de Diamant). */
export function tierText(tier: string, division: string | null | undefined): string {
  const t = TIER_LABEL[tier] ?? tier;
  return division && !APEX.includes(tier) ? `${t} ${division}` : t;
}

/** Couleur des LP selon le palier, proche des couleurs des emblemes Riot. */
export const TIER_COLOR: Record<string, string> = {
  CHALLENGER: "#f0c66e",
  GRANDMASTER: "#ef4f5f",
  MASTER: "#b86ee0",
  DIAMOND: "#6f86e8",
  EMERALD: "#2fbf86",
  PLATINUM: "#4fb3b5",
  GOLD: "#d39a45",
  SILVER: "#93a6ab",
  BRONZE: "#a8694c",
  IRON: "#8a8580",
};

/** Poste declare sur Leaguepedia vers le poste Riot. */
export function proRole(role: string): Role | null {
  const r = role.toLowerCase();
  if (r.startsWith("top")) return "TOP";
  if (r.startsWith("jun")) return "JUNGLE";
  if (r.startsWith("mid")) return "MIDDLE";
  if (r.startsWith("bot") || r === "adc") return "BOTTOM";
  if (r.startsWith("sup")) return "UTILITY";
  return null;
}

/** Initiales d'une equipe, a la place de son logo (non reproduit). */
export const teamMark = (name: string) => name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
