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
import type { Catalog, LoadingRosterDto } from "../platform/api";

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

  if (!roster) return null;
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
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
