// Modele de domaine normalise, independant de la source (backend NEX, demo, LCU).

export type Queue = "solo" | "flex" | "normal" | "aram" | "other";
export type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

export interface MatchSummary {
  id: string;
  queue: Queue;
  /** Partie ARAM Mayhem (file 2400), rangee avec les ARAM mais nommee a part. */
  mayhem?: boolean;
  /** Cle Data Dragon du champion (ex. "Ahri"). */
  champion: string;
  championLevel: number;
  role: Role | null;
  win: boolean;
  /** Partie annulee (remake) : exclue des moyennes. */
  remake: boolean;
  /** Debut de partie, ms epoch. */
  startedAt: number;
  durationSec: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Sbires + monstres neutres. */
  cs: number;
  teamKills: number;
  damageToChampions: number;
  teamDamageToChampions: number;
  visionScore: number;
  soloKills: number | null;
  /** Ecart d'or avec l'adversaire direct a 15:00, si timeline disponible. */
  goldDiffAt15: number | null;
  /** Variation de LP observee (null si non observee). */
  lpDelta: number | null;
}

export interface RankEntry {
  queue: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";
  tier: string;
  division: string | null;
  lp: number;
  wins: number;
  losses: number;
}

export interface PlayerSummary {
  gameName: string;
  tagLine: string;
  platform: string;
  level: number;
  profileIconId: number;
  /** Champion utilise pour l'illustration du bandeau. */
  bannerChampion: string;
  ranks: RankEntry[];
  updatedAt: number;
}

/** Provenance affichee avec chaque jeu de donnees. */
export interface DataProvenance {
  source: "demo" | "nex-backend" | "local-client";
  label: string;
  updatedAt: number;
}
