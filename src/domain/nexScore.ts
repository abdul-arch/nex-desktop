// Score NEX : note 0-100 explicable d'une partie.
//
// Methode (documentee dans docs/METHODE_STATISTIQUE.md) :
//   composante_i = clamp((x_i - repere_i) / echelle_i, -1, 1)
//   score = 50 + 50 * somme(poids_i * composante_i)      (poids normalises sur les composantes disponibles)
// 50 = au niveau du repere du role ; 100 = toutes les composantes au plafond.
//
// Les reperes ci-dessous sont PROVISOIRES (valeurs indicatives fixees a la main) :
// ils seront remplaces par des medianes par role/rang/patch calculees par le backend NEX.
import type { MatchSummary, Role } from "./types";

export const NEX_SCORE_VERSION = "0.1-provisoire";

interface Baseline {
  kda: number;
  kp: number;
  csm: number;
  dmgShare: number;
  visionPerMin: number;
}

export const BASELINES: Record<Role | "ANY", Baseline> = {
  TOP: { kda: 2.4, kp: 0.45, csm: 6.8, dmgShare: 0.22, visionPerMin: 0.6 },
  JUNGLE: { kda: 3.0, kp: 0.6, csm: 5.6, dmgShare: 0.17, visionPerMin: 0.9 },
  MIDDLE: { kda: 2.8, kp: 0.52, csm: 7.2, dmgShare: 0.25, visionPerMin: 0.65 },
  BOTTOM: { kda: 2.8, kp: 0.52, csm: 7.6, dmgShare: 0.26, visionPerMin: 0.55 },
  UTILITY: { kda: 2.9, kp: 0.6, csm: 1.2, dmgShare: 0.11, visionPerMin: 1.9 },
  ANY: { kda: 2.8, kp: 0.53, csm: 6.0, dmgShare: 0.2, visionPerMin: 0.85 },
};

const COMPONENTS = [
  { key: "kda", label: "KDA", weight: 0.3, scale: (b: Baseline) => b.kda },
  { key: "kp", label: "Participation", weight: 0.2, scale: () => 0.25 },
  { key: "csm", label: "CS/min", weight: 0.2, scale: (b: Baseline) => Math.max(1, b.csm * 0.35) },
  { key: "dmgShare", label: "Part des dégâts", weight: 0.2, scale: (b: Baseline) => b.dmgShare * 0.6 },
  { key: "visionPerMin", label: "Vision/min", weight: 0.1, scale: (b: Baseline) => b.visionPerMin * 0.8 },
] as const;

export interface NexScoreBreakdown {
  score: number | null;
  components: { label: string; value: number; baseline: number; contribution: number }[];
  version: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function nexScore(m: MatchSummary): NexScoreBreakdown {
  const min = m.durationSec / 60;
  if (m.remake || !(min > 0)) return { score: null, components: [], version: NEX_SCORE_VERSION };
  // ARAM et ARAM Mayhem : pas de note. Les reperes ci-dessus valent pour la Faille (CS/min,
  // vision, participation) ; les appliquer a l'ARAM donnerait un chiffre trompeur. A rouvrir
  // quand des reperes ARAM auront ete mesures.
  if (m.queue === "aram") return { score: null, components: [], version: NEX_SCORE_VERSION };
  const b = BASELINES[m.role ?? "ANY"];
  const values: Record<(typeof COMPONENTS)[number]["key"], number | null> = {
    kda: (m.kills + m.assists) / Math.max(1, m.deaths),
    kp: m.teamKills > 0 ? (m.kills + m.assists) / m.teamKills : null,
    csm: m.cs / min,
    dmgShare: m.teamDamageToChampions > 0 ? m.damageToChampions / m.teamDamageToChampions : null,
    visionPerMin: m.visionScore / min,
  };
  const available = COMPONENTS.filter((c) => values[c.key] !== null);
  const totalWeight = available.reduce((a, c) => a + c.weight, 0);
  if (totalWeight === 0) return { score: null, components: [], version: NEX_SCORE_VERSION };
  const components = available.map((c) => {
    const value = values[c.key] as number;
    const baseline = b[c.key];
    const norm = clamp((value - baseline) / c.scale(b), -1, 1);
    return { label: c.label, value, baseline, contribution: 50 * (c.weight / totalWeight) * norm };
  });
  const score = clamp(50 + components.reduce((a, c) => a + c.contribution, 0), 0, 100);
  return { score, components, version: NEX_SCORE_VERSION };
}
