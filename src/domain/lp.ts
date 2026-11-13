// Historique des LP : echelle absolue, et rattachement d'une variation a une partie.
//
// Riot ne fournit que le rang courant. NEX enregistre un releve a chaque lecture de profil
// (backend, sans requete supplementaire) ; l'historique commence donc au premier releve et
// ne remonte jamais dans le passe. Tout ce qui suit ne lit que ces releves.
import type { RankSnapshotDto } from "../platform/api";
import type { MatchSummary } from "./types";

/** Paliers a quatre divisions, du plus bas au plus haut. */
const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
/** Offset des divisions dans un palier : IV est le bas, I le haut. */
const DIVISIONS: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
/** Base des paliers sans division : Maitre, Grand Maitre et Challenger partagent une echelle continue. */
const APEX = TIERS.length * 400;

/**
 * Position absolue sur l'echelle, en points, pour comparer deux releves a travers un
 * changement de palier : Diamant I 95 LP -> Maitre 10 LP vaut +15, et non -85.
 * `null` si le palier est inconnu (file non classee, donnee inattendue).
 */
export function ladderPoints(tier: string, division: string | null, lp: number): number | null {
  const t = tier.toUpperCase();
  if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(t)) return APEX + lp;
  const i = TIERS.indexOf(t);
  if (i < 0) return null;
  // Un palier a divisions sans division exploitable : la position exacte est inconnue.
  const d = DIVISIONS[(division ?? "").toUpperCase()];
  return d === undefined ? null : i * 400 + d * 100 + lp;
}

/** File classee correspondant a un identifiant de file Riot, ou null. */
export function queueOfMatch(m: Pick<MatchSummary, "queue">): string | null {
  return m.queue === "solo" ? "RANKED_SOLO_5x5" : m.queue === "flex" ? "RANKED_FLEX_SR" : null;
}

export interface LpChange {
  at: number;
  /** Instant du releve precedent : la variation s'est produite entre `from` et `at`. */
  from: number;
  /** Variation en points d'echelle depuis le releve precedent. */
  delta: number;
  /** Position absolue apres le changement, pour tracer une courbe. */
  points: number;
  snapshot: RankSnapshotDto;
}

/**
 * Suite des variations observees pour une file, du plus ancien au plus recent.
 * Le tout premier releve n'est pas une variation : il n'y a rien avant lui.
 */
export function lpChanges(snapshots: RankSnapshotDto[], queue: string): LpChange[] {
  const snaps = snapshots
    .filter((s) => s.queue === queue)
    .map((s) => ({ s, p: ladderPoints(s.tier, s.division, s.lp) }))
    .filter((x): x is { s: RankSnapshotDto; p: number } => x.p !== null)
    .sort((a, b) => a.s.at - b.s.at);
  const out: LpChange[] = [];
  for (let i = 1; i < snaps.length; i++) {
    out.push({ at: snaps[i].s.at, from: snaps[i - 1].s.at, delta: snaps[i].p - snaps[i - 1].p, points: snaps[i].p, snapshot: snaps[i].s });
  }
  return out;
}

/**
 * Serie a tracer : les LP gagnes ou perdus depuis le premier releve, en partant de 0.
 * Relatif, parce qu'un changement de palier rend les LP bruts trompeurs — « 95 » puis
 * « 10 » est une montee, pas une chute. `net` est le solde de la periode.
 */
export function lpSeries(changes: LpChange[]): { values: number[]; net: number; since: number } | null {
  if (changes.length === 0) return null;
  const base = changes[0].points - changes[0].delta;
  const values = [0, ...changes.map((c) => c.points - base)];
  return { values, net: values[values.length - 1], since: changes[0].from };
}

/**
 * Rattache chaque variation de LP a une partie, par identifiant de partie.
 *
 * Une variation n'est attribuee que si UNE SEULE partie classee de la bonne file s'est
 * terminee entre les deux releves. Si deux parties y tiennent, la variation reste sans
 * proprietaire : la repartir serait inventer. Une partie sans variation garde `null`,
 * ce que l'interface affiche comme « Victoire » ou « Défaite » plutot qu'un faux chiffre.
 */
export function attributeLp(matches: MatchSummary[], snapshots: RankSnapshotDto[]): Map<string, number> {
  const out = new Map<string, number>();
  const ends = matches
    .filter((m) => !m.remake && queueOfMatch(m) !== null)
    .map((m) => ({ id: m.id, queue: queueOfMatch(m) as string, at: m.startedAt + m.durationSec * 1000 }));

  for (const queue of ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"]) {
    const changes = lpChanges(snapshots, queue);
    const inQueue = ends.filter((e) => e.queue === queue);
    for (const c of changes) {
      // Fenetre fermee : les parties d'avant le premier releve ne sont jamais rattachees,
      // c'est precisement ce que NEX n'a pas observe.
      const between = inQueue.filter((e) => e.at > c.from && e.at <= c.at);
      if (between.length === 1) out.set(between[0].id, c.delta);
    }
  }
  return out;
}
