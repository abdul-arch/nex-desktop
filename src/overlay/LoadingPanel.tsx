// Panneau de l'ecran de chargement : les dix joueurs de la partie qui demarre.
//
// SOURCE : le client local uniquement (`/lol-gameflow/v1/session`), donc aucun appel a
// Riot et aucune limite de debit consommee. Le client ne publie ici ni pseudo, ni poste,
// ni sorts d'invocateur : seulement l'identifiant de chaque joueur et son champion. Le
// rang et la forme recente demanderont des appels supplementaires, et ne sont pas
// affiches tant qu'ils ne sont pas reellement lus.

import { useEffect, useState } from "react";
import { championIcon } from "../data/assets";
import { platform } from "../platform";
import type { Catalog, LoadingRosterDto, PlayerRanksDto, RankDto } from "../platform/api";
import { TIER_COLOR, tierText } from "../features/leaderboards/shared";

const QUEUES: Record<number, string> = {
  420: "Classée Solo/Duo",
  440: "Classée Flexible",
  400: "Normale draft",
  430: "Normale aveugle",
  450: "ARAM",
  490: "Normale rapide",
  1700: "Arena",
  2400: "ARAM Mayhem",
};

/** Interrogation du client tant qu'aucune composition n'est publiee. */
const POLL_MS = 2000;

/** File dont on montre le rang : celle de la partie, Solo/Duo par defaut. */
const rankedQueue = (queueId: number) => (queueId === 440 ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5");

export function LoadingPanel({
  catalog,
  version,
  live,
  onActive,
}: {
  catalog: Catalog | null;
  version: string | null;
  live: boolean;
  /** Prevenu quand le panneau occupe l'ecran : les widgets de partie s'effacent alors. */
  onActive: (active: boolean) => void;
}) {
  const [roster, setRoster] = useState<LoadingRosterDto | null>(null);
  // `null` tant que la lecture des rangs n'a pas abouti : on ne sait pas encore, ce qui
  // n'est pas la meme chose que « non classe ».
  const [ranks, setRanks] = useState<PlayerRanksDto[] | null>(null);
  useEffect(() => onActive(!!roster), [roster, onActive]);

  useEffect(() => {
    // Une fois la partie commencee, l'overlay en jeu prend le relais.
    if (live) {
      setRoster(null);
      return;
    }
    let alive = true;
    const read = () =>
      platform
        .loadingRoster()
        .then((r) => alive && setRoster(r))
        .catch(() => alive && setRoster(null));
    read();
    const id = window.setInterval(read, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [live]);

  // Rangs : un appel groupe par partie, pas a chaque sondage du client.
  const gameId = roster?.gameId ?? null;
  useEffect(() => {
    if (!roster) {
      setRanks(null);
      return;
    }
    let alive = true;
    setRanks(null);
    platform
      .getSettings()
      .then((st) => platform.ranksBulk(st.linkedPlatform || st.defaultPlatform, roster.players.map((p) => p.puuid)))
      .then((r) => alive && setRanks(r))
      .catch(() => alive && setRanks([]));
    return () => {
      alive = false;
    };
    // Une nouvelle partie relance la lecture ; les sondages suivants ne la relancent pas.
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!roster) return null;
  const queue = rankedQueue(roster.queueId);
  // Trois etats distincts, et aucun ne doit en remplacer un autre : pas encore lu,
  // lecture echouee pour ce joueur, et classe ou non dans la file de la partie.
  const rankOf = (puuid: string): RankState => {
    if (!ranks) return { state: "loading" };
    const e = ranks.find((r) => r.puuid === puuid);
    if (!e) return { state: "unavailable" };
    const entry = e.ranks.find((r) => r.queue === queue);
    return entry ? { state: "ok", entry } : { state: "unranked" };
  };
  const name = (id?: number) => (id && catalog ? catalog.champions[String(id)] : undefined);
  const team = (n: number) => roster.players.filter((p) => p.team === n);

  return (
    <div className="ld-panel">
      <div className="ld-head">
        <b>{QUEUES[roster.queueId] ?? `File ${roster.queueId}`}</b>
        <span className="ov-sub">{roster.players.length} joueurs · lus dans le client, aucun appel à Riot</span>
      </div>
      {[1, 2].map((t) => (
        <div key={t} className={`ld-row ${t === 1 ? "blue" : "red"}`}>
          {team(t).map((p) => {
            const c = name(p.championId);
            const src = c ? championIcon(version, c.key) : null;
            return (
              <div key={p.puuid} className={`ld-card ${p.isMe ? "me" : ""}`}>
                {src ? <img src={src} alt="" width={44} height={44} /> : <span className="ld-slot" aria-hidden="true" />}
                <b>{c?.name ?? "Champion non publié"}</b>
                {p.isMe && <span className="ld-me">toi</span>}
                <Rank s={rankOf(p.puuid)} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type RankState = { state: "loading" } | { state: "unavailable" } | { state: "unranked" } | { state: "ok"; entry: RankDto };

/** Rang d'un joueur, avec ses trois etats d'ignorance distincts. */
function Rank({ s }: { s: RankState }) {
  if (s.state === "loading") return <span className="ld-rank muted">rang en lecture…</span>;
  if (s.state === "unavailable") return <span className="ld-rank muted">rang indisponible</span>;
  if (s.state === "unranked") return <span className="ld-rank muted">non classé</span>;
  const entry = s.entry;
  const total = entry.wins + entry.losses;
  return (
    <span className="ld-rank">
      <b style={{ color: TIER_COLOR[entry.tier] ?? "var(--text)" }}>{tierText(entry.tier, entry.division)}</b>
      <span>{entry.lp} LP</span>
      {total > 0 && (
        <span className="ld-wl">
          {Math.round((entry.wins / total) * 100)} % · {entry.wins}V-{entry.losses}D
        </span>
      )}
    </span>
  );
}
