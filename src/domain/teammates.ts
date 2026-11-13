// Coequipiers frequents : personnes vues dans la meme equipe sur les parties chargees.
// Calcule uniquement a partir des participants renvoyes par Riot (ou le client League) ;
// une partie annulee (remake) ne compte pas, un participant sans identite non plus.
import type { MatchDto } from "../platform/api";

export interface Teammate {
  /** Identite de la personne : son Riot ID le plus recent, en minuscules. */
  id: string;
  /** « Pseudo#TAG » le plus recent vu pour cette personne. */
  riotId: string;
  /** Parties jouees ensemble (dans la meme equipe). */
  games: number;
  /** Victoires ensemble. */
  wins: number;
  /** Champion le plus joue par cette personne dans ces parties (cle Data Dragon). */
  champion: string | null;
}

/**
 * Coequipiers les plus frequents de `puuid`, du plus vu au moins vu.
 * `min` parties ensemble au minimum (2 par defaut : une seule partie commune ne dit rien).
 */
interface Tally {
  riotId: string;
  /** Date de la partie la plus recente vue pour cette personne. */
  at: number;
  games: number;
  wins: number;
  champs: Map<string, number>;
}

function absorb(into: Tally, from: Tally) {
  into.games += from.games;
  into.wins += from.wins;
  for (const [champion, n] of from.champs) into.champs.set(champion, (into.champs.get(champion) ?? 0) + n);
  if (from.at > into.at) {
    into.at = from.at;
    into.riotId = from.riotId;
  }
}

export function frequentTeammates(matches: MatchDto[], puuid: string, min = 2, limit = 5): Teammate[] {
  // 1) Regroupement par identifiant interne : suit la personne a travers un changement de pseudo.
  const bySource = new Map<string, Tally>();
  for (const m of matches) {
    if (m.remake) continue;
    const me = m.participants.find((p) => p.puuid === puuid);
    if (!me) continue;
    const mine = `${me.gameName}#${me.tagLine}`.toLowerCase();
    for (const p of m.participants) {
      if (p.puuid === puuid || p.teamId !== me.teamId || !p.gameName || !p.tagLine) continue;
      const riotId = `${p.gameName}#${p.tagLine}`;
      // Le joueur lui-meme porte un autre identifiant interne dans les parties du client.
      if (riotId.toLowerCase() === mine) continue;
      const key = p.puuid || riotId.toLowerCase();
      const t = bySource.get(key) ?? { riotId: "", at: -1, games: 0, wins: 0, champs: new Map() };
      bySource.set(key, t);
      absorb(t, { riotId, at: m.startedAt, games: 1, wins: p.win ? 1 : 0, champs: new Map([[p.champion, 1]]) });
    }
  }

  // 2) Fusion par Riot ID : les parties lues dans le client League portent d'autres
  //    identifiants internes que celles de l'API Riot, pour une seule et meme personne.
  const byPerson = new Map<string, Tally>();
  for (const t of bySource.values()) {
    const id = t.riotId.toLowerCase();
    const cur = byPerson.get(id);
    if (cur) absorb(cur, t);
    else byPerson.set(id, t);
  }

  return [...byPerson.entries()]
    .filter(([, t]) => t.games >= min)
    .sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins)
    .slice(0, limit)
    .map(([id, t]) => ({
      id,
      riotId: t.riotId,
      games: t.games,
      wins: t.wins,
      champion: [...t.champs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }));
}
