// Collection de skins : etat possede / manquant / inconnu, regroupements, valeur catalogue estimee.
import type { SkinEntry, SkinInventory, SkinRarity } from "../platform/api";

export const RARITIES: { id: SkinRarity; label: string; color: string }[] = [
  { id: "standard", label: "Standard", color: "#8b8fa3" },
  { id: "rare", label: "Rare", color: "#5ec2b7" },
  { id: "epic", label: "Épique", color: "#5795ff" },
  { id: "legendary", label: "Légendaire", color: "#f0596b" },
  { id: "mythic", label: "Mythique", color: "#b77cf2" },
  { id: "ultimate", label: "Ultime", color: "#e8b65a" },
  { id: "exalted", label: "Exalté", color: "#ff8fd8" },
  { id: "transcendent", label: "Transcendant", color: "#7df0ff" },
];

/**
 * Prix catalogue INDICATIF par rarete (RP). Aucune source ne fournit les prix : ce sont les tarifs
 * habituels de la boutique pour ces raretes. Standard (390 a 975 RP), Rare, Mythique, Exalte et
 * Transcendant n'ont pas de prix RP direct ou fiable : null = « prix inconnu ».
 */
export const RARITY_RP: Partial<Record<SkinRarity, number>> = { epic: 1350, legendary: 1820, ultimate: 3250 };

export type OwnState = "owned" | "missing" | "unknown";

export interface SkinView extends SkinEntry {
  state: OwnState;
  acquiredAt: number | null;
  obtainable: boolean | null;
  price: number | null;
}

export function viewSkins(skins: SkinEntry[], inv: SkinInventory | null): SkinView[] {
  const known = !!inv && inv.source !== "unknown";
  const owned = new Map((inv?.owned ?? []).map((o) => [o.id, o.acquiredAt]));
  const gone = new Set(inv?.unobtainable ?? []);
  return skins.map((s) => ({
    ...s,
    state: !known ? "unknown" : owned.has(s.id) ? "owned" : "missing",
    acquiredAt: owned.get(s.id) ?? null,
    obtainable: inv?.obtainableKnown ? !gone.has(s.id) : null,
    price: RARITY_RP[s.rarity] ?? null,
  }));
}

export interface CollectionSummary {
  owned: number;
  total: number;
  /** Somme des prix indicatifs des skins possedes qui en ont un. */
  estimatedRp: number;
  ownedWithoutPrice: number;
}

export function summarize(views: SkinView[]): CollectionSummary {
  const owned = views.filter((v) => v.state === "owned");
  return {
    owned: owned.length,
    total: views.length,
    estimatedRp: owned.reduce((a, v) => a + (v.price ?? 0), 0),
    ownedWithoutPrice: owned.filter((v) => v.price === null).length,
  };
}

export type GroupBy = "year" | "champion" | "rarity" | "line" | "none";

export function groupKey(v: SkinView, by: GroupBy, championName: (id: number) => string, lineName: (id: number) => string): string {
  switch (by) {
    case "year":
      if (v.acquiredAt) return `Acquis en ${new Date(v.acquiredAt).getFullYear()}`;
      return v.state === "owned" ? "Date d'acquisition inconnue" : v.state === "missing" ? "Non possédés" : "Possession inconnue";
    case "champion":
      return championName(v.championId);
    case "rarity":
      return RARITIES.find((r) => r.id === v.rarity)?.label ?? v.rarity;
    case "line":
      return v.lines.length ? lineName(v.lines[0]) : "Sans série";
    default:
      return "Tous les skins";
  }
}
