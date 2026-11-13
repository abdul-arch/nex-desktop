// Resultats personnels par duel, a partir des parties du compte lie (memes cles de cache que
// le dashboard : aucune requete supplementaire si le dashboard a deja charge).
import { useMemo } from "react";
import { useAppState } from "../../app/AppState";
import { useAsync } from "../../app/useAsync";
import { findParticipant, laneOpponent } from "../../domain/fromMatch";
import { platform } from "../../platform";
import type { MatchDto, MatchPageDto, PlayerProfileDto } from "../../platform/api";

export interface PersonalDuel {
  wins: number;
  losses: number;
  matches: MatchDto[];
}

export function usePersonalMatchups(championId: number | null) {
  const { settings } = useAppState();
  const riotId = settings.demoMode ? "" : settings.linkedRiotId;
  const plat = settings.linkedPlatform;
  const profile = useAsync<PlayerProfileDto>(riotId ? `profile:${plat}:${riotId.toLowerCase()}` : null, () => platform.playerProfile(riotId, plat), 60_000);
  const puuid = profile.data?.puuid ?? null;
  const page = useAsync<MatchPageDto>(
    puuid ? `dash-matches:${plat}:${puuid}` : null,
    () => platform.playerMatches({ platform: plat, puuid: puuid!, start: 0, count: 20, timelines: 10 }),
    120_000,
  );
  const byOpponent = useMemo(() => {
    const map = new Map<number, PersonalDuel>();
    if (!puuid || !championId) return map;
    for (const m of page.data?.matches ?? []) {
      if (m.remake) continue;
      const me = findParticipant(m, puuid);
      if (!me || me.championId !== championId) continue;
      const opp = laneOpponent(m, me);
      if (!opp) continue;
      const d = map.get(opp.championId) ?? { wins: 0, losses: 0, matches: [] };
      if (me.win) d.wins++;
      else d.losses++;
      d.matches.push(m);
      map.set(opp.championId, d);
    }
    return map;
  }, [page.data, puuid, championId]);
  return { linked: !!riotId, puuid, byOpponent, sample: page.data?.matches.length ?? 0 };
}
