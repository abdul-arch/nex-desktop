// Regroupement des parties par journee et par session de jeu.
//
// Une session est une suite de parties rapprochees : on coupe des qu'il s'ecoule plus de
// `GAP` entre la fin d'une partie et le debut de la suivante. Deux heures, parce qu'en
// dessous une pause normale (une file longue, un repas rapide) couperait a tort, et
// au-dessus deux soirees distinctes se retrouveraient fusionnees.
import type { MatchSummary } from "./types";

/** Coupure entre deux sessions. */
export const SESSION_GAP_MS = 2 * 3600_000;

/** Ce dont le regroupement a besoin : tout `MatchSummary` convient. */
export type Playable = Pick<MatchSummary, "id" | "startedAt" | "durationSec" | "win" | "remake"> & { lpDelta?: number | null };

export interface Tally {
  games: number;
  wins: number;
  losses: number;
  /** Secondes de jeu cumulees. */
  durationSec: number;
  /** Somme des variations de LP connues, null si aucune n'est connue. */
  lpDelta: number | null;
}

function tally(matches: Playable[]): Tally {
  const counted = matches.filter((m) => !m.remake);
  const lps = matches.map((m) => m.lpDelta).filter((x): x is number => x !== null && x !== undefined);
  return {
    games: matches.length,
    wins: counted.filter((m) => m.win).length,
    losses: counted.filter((m) => !m.win).length,
    durationSec: matches.reduce((a, m) => a + m.durationSec, 0),
    lpDelta: lps.length ? lps.reduce((a, b) => a + b, 0) : null,
  };
}

export interface DayGroup extends Tally {
  /** Minuit local du jour, en ms : identifiant stable du groupe. */
  day: number;
  /** « Aujourd'hui », « Hier », ou « dimanche 8 novembre ». */
  label: string;
  matches: Playable[];
}

const midnight = (at: number) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** « Aujourd'hui », « Hier », sinon le jour en toutes lettres. `now` facilite les tests. */
export function dayLabel(day: number, now = Date.now()): string {
  const today = midnight(now);
  if (day === today) return "Aujourd'hui";
  if (day === today - 86_400_000) return "Hier";
  return new Date(day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

/**
 * Parties groupees par journee, de la plus recente a la plus ancienne.
 * Une partie est rangee au jour ou elle a commence, heure locale.
 */
export function groupByDay<T extends Playable>(matches: T[], now = Date.now()): (DayGroup & { matches: T[] })[] {
  const byDay = new Map<number, T[]>();
  for (const m of [...matches].sort((a, b) => b.startedAt - a.startedAt)) {
    const d = midnight(m.startedAt);
    const list = byDay.get(d);
    if (list) list.push(m);
    else byDay.set(d, [m]);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, list]) => ({ day, label: dayLabel(day, now), matches: list, ...tally(list) }));
}

export interface Session extends Tally {
  startedAt: number;
  /** Fin de la derniere partie de la session. */
  endedAt: number;
}

/**
 * Sessions de jeu, de la plus recente a la plus ancienne.
 * Une partie seule forme une session d'une partie : c'est bien ce qui s'est passe.
 */
export function sessions<T extends Playable>(matches: T[], gapMs = SESSION_GAP_MS): (Session & { matches: T[] })[] {
  const sorted = [...matches].sort((a, b) => a.startedAt - b.startedAt);
  const groups: T[][] = [];
  for (const m of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    // On compare au debut de la partie suivante la FIN de la precedente : une partie de
    // 45 minutes ne doit pas ouvrir une session a elle seule.
    if (last && prev && m.startedAt - (prev.startedAt + prev.durationSec * 1000) <= gapMs) last.push(m);
    else groups.push([m]);
  }
  return groups
    .map((list) => {
      const last = list[list.length - 1];
      return { startedAt: list[0].startedAt, endedAt: last.startedAt + last.durationSec * 1000, matches: list, ...tally(list) };
    })
    .reverse();
}

/** Derniere session jouee, ou null s'il n'y a aucune partie. */
export function lastSession<T extends Playable>(matches: T[], gapMs = SESSION_GAP_MS): (Session & { matches: T[] }) | null {
  return sessions(matches, gapMs)[0] ?? null;
}
