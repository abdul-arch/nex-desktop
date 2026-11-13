import { Eye, Monitor, RotateCw, Search, Star, UserCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { parseRiotId, PLATFORMS, platformLabel } from "../../domain/riotId";
import { errorMessage, platform } from "../../platform";
import type { LiveGameDto, PlayerProfileDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { duration, timeAgo } from "../../ui/format";
import { ChampIcon, EmptyState } from "../../ui/primitives";
import { useChampionById } from "../stats/statsShared";

const QUEUES: Record<number, string> = {
  420: "Classée Solo/Duo",
  440: "Classée Flex",
  400: "Normale (draft)",
  430: "Normale (aveugle)",
  490: "Partie rapide",
  450: "ARAM",
  1700: "Arena",
  2400: "ARAM Mayhem",
  0: "Partie personnalisée",
};
/** Nombre de joueurs suivis verifies automatiquement (2 requetes Riot chacun). */
const AUTO_CHECK = 8;

interface Target {
  riotId: string;
  plat: string;
  tag: "linked" | "favorite" | "search";
}

export function SpectatePage() {
  const { settings, favorites } = useAppState();
  const client = useClient();
  // Amis dont la partie peut etre regardee : le client League n'accepte que ceux-la.
  const connected = platform.capabilities.localClient && client.state?.status === "connected";
  const friendsQ = useAsync<string[]>(connected ? "observable-friends" : null, () => platform.observableFriends(), 30_000);
  // Comparaison par Riot ID (le client et l'API Riot n'utilisent pas le meme identifiant de joueur).
  const friends = useMemo(() => new Set((friendsQ.data ?? []).map((r) => r.toLowerCase())), [friendsQ.data]);
  const [input, setInput] = useState("");
  const [plat, setPlat] = useState(settings.defaultPlatform);
  const [searched, setSearched] = useState<Target | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const targets: Target[] = [];
  if (settings.linkedRiotId) targets.push({ riotId: settings.linkedRiotId, plat: settings.linkedPlatform, tag: "linked" });
  for (const f of favorites) {
    const id = `${f.gameName}#${f.tagLine}`;
    if (!targets.some((t) => t.riotId.toLowerCase() === id.toLowerCase() && t.plat === f.platform)) targets.push({ riotId: id, plat: f.platform, tag: "favorite" });
  }

  const submit = () => {
    const p = parseRiotId(input);
    if (!p.ok) {
      setErr(p.error);
      return;
    }
    setErr(null);
    setSearched({ riotId: `${p.value.gameName}#${p.value.tagLine}`, plat, tag: "search" });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <Monitor aria-hidden="true" /> Spectate
        </h1>
        <div className="spacer" />
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        Vérifie si un joueur est en partie (Riot spectator-v5). Le client League permet de regarder les parties de tes amis : pour eux, NEX
        ouvre la partie en spectateur.
      </p>

      <form
        className="card card-pad spec-search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="search-box" style={{ flex: 1 }}>
          <Search size={14} aria-hidden="true" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pseudo#TAG" aria-label="Riot ID" aria-invalid={!!err} />
        </label>
        <select className="select" value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Région">
          {PLATFORMS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" type="submit">
          Vérifier
        </button>
        {err && (
          <span className="field-error" role="alert">
            {err}
          </span>
        )}
      </form>

      {searched && <SpectateRow key={`s:${searched.plat}:${searched.riotId}`} target={searched} auto friends={friends} />}

      <div className="card-title" style={{ margin: "18px 0 8px" }}>
        Joueurs suivis
      </div>
      {targets.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Star />} title="Aucun joueur suivi">
            Lie ton compte dans Paramètres ou ajoute des favoris depuis un profil : leur statut apparaîtra ici.
          </EmptyState>
        </div>
      ) : (
        <div className="spec-list">
          {targets.map((t, i) => (
            <SpectateRow key={`${t.plat}:${t.riotId}`} target={t} auto={i < AUTO_CHECK} friends={friends} />
          ))}
        </div>
      )}
    </div>
  );
}

function SpectateRow({ target, auto, friends }: { target: Target; auto: boolean; friends: Set<string> }) {
  const { navigate } = useNav();
  const { notify } = useAppState();
  const client = useClient();
  const byId = useChampionById();
  const version = useDDragonVersion();
  const [enabled, setEnabled] = useState(auto);
  const [launching, setLaunching] = useState(false);
  const profile = useAsync<PlayerProfileDto>(
    enabled ? `profile:${target.plat}:${target.riotId.toLowerCase()}` : null,
    () => platform.playerProfile(target.riotId, target.plat),
    60_000,
  );
  const puuid = profile.data?.puuid;
  const live = useAsync<LiveGameDto>(puuid ? `live:${target.plat}:${puuid}` : null, () => platform.liveGame(target.plat, puuid!), 30_000);
  const g = live.data;

  // Chrono de partie mis a jour chaque seconde seulement si la partie est affichee.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!g?.inGame) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [g?.inGame]);

  const clientReady = platform.capabilities.localClient && client.state?.status === "connected";
  const sameRegion = client.state?.summoner?.platform ? client.state.summoner.platform === target.plat : true;
  const isFriend = friends.has(target.riotId.toLowerCase());

  const watch = async () => {
    setLaunching(true);
    try {
      await platform.spectate(target.riotId);
      notify("Le client League ouvre la partie en spectateur (délai Riot d'environ 3 minutes, chargement compris).", "info");
    } catch (e) {
      notify(`Spectate impossible : ${errorMessage(e)}`, "error");
    } finally {
      setLaunching(false);
    }
  };

  let status;
  if (!enabled) status = <span className="muted">Non vérifié</span>;
  else if (profile.error != null && !profile.data) status = <span className="neg">{errorMessage(profile.error)}</span>;
  else if (live.error != null && !g) status = <span className="neg">{errorMessage(live.error)}</span>;
  else if (!g) status = <span className="muted">Vérification…</span>;
  else if (!g.inGame) status = <span className="muted">Pas en partie · vérifié {timeAgo(g.fetchedAt)}</span>;
  else
    status = (
      <span className="spec-live">
        <i aria-hidden="true" /> En partie · {QUEUES[g.queueId ?? -1] ?? g.gameMode ?? "Mode inconnu"}
        {g.startTime ? ` · ${duration((now - g.startTime) / 1000)}` : " · chargement"}
      </span>
    );

  return (
    <div className={`card spec-row ${g?.inGame ? "live" : ""}`}>
      <div className="spec-head">
        <span className="spec-tag" title={target.tag === "linked" ? "Ton compte" : target.tag === "favorite" ? "Favori" : "Recherche"}>
          {target.tag === "linked" ? <UserCheck size={14} /> : target.tag === "favorite" ? <Star size={14} /> : <Search size={14} />}
        </span>
        <button className="link-btn" onClick={() => navigate("profile", { riotId: target.riotId, platform: target.plat })}>
          <b>{target.riotId}</b>
        </button>
        <span className="muted">{platformLabel(target.plat)}</span>
        <span className="spec-status">{status}</span>
        <span className="spacer" />
        {!enabled ? (
          <button className="btn btn-sm" onClick={() => setEnabled(true)}>
            Vérifier
          </button>
        ) : (
          <button className="icon-btn" onClick={() => live.reload()} disabled={!puuid || live.loading} aria-label={`Revérifier ${target.riotId}`}>
            <RotateCw />
          </button>
        )}
        {g?.inGame && (
          <button
            className="btn btn-sm btn-primary"
            onClick={watch}
            disabled={!clientReady || !sameRegion || !isFriend || launching}
            title={
              !platform.capabilities.localClient
                ? "Disponible dans l'application de bureau uniquement"
                : !clientReady
                  ? "Ouvre le client League pour regarder la partie"
                  : !sameRegion
                    ? "Le client League est connecté à une autre région"
                    : !isFriend
                      ? "Le client League ne permet de regarder que les parties de tes amis (partie observable)"
                      : "Ouvre la partie en spectateur dans le client League (délai Riot d'environ 3 min)"
            }
          >
            <Eye /> Regarder dans le client
          </button>
        )}
      </div>
      {g?.inGame && g.participants.length > 0 && (
        <div className="spec-teams">
          {[100, 200].map((team) => (
            <div key={team} className={`spec-team t${team}`}>
              {g.participants
                .filter((p) => p.teamId === team)
                .map((p, i) => {
                  const c = byId(p.championId);
                  const me = p.puuid === puuid;
                  return (
                    <span key={p.puuid || `${team}-${i}`} className={`spec-player ${me ? "me" : ""}`} title={c?.name}>
                      <ChampIcon version={version} champion={c?.key ?? ""} size={24} rounded={6} />
                      <span>{p.riotId || "Joueur masqué"}</span>
                    </span>
                  );
                })}
            </div>
          ))}
        </div>
      )}
      {live.error != null && g && <ErrorPanel compact error={live.error} />}
    </div>
  );
}
