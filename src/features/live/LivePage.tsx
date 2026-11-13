import { Crosshair, LayoutGrid, Link2, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { STAGE_LABEL, useClient } from "../../app/ClientContext";
import { useNav } from "../../app/navigation";
import { platformLabel } from "../../domain/riotId";
import { errorMessage, platform } from "../../platform";
import type { DraftSlotDto, LivePlayer } from "../../platform/api";
import { duration, ROLE_LABEL } from "../../ui/format";
import { ChampIcon, EmptyState, PositionIcon } from "../../ui/primitives";
import { ItemIcon } from "../profile/GameIcons";
import { useChampionById } from "../stats/statsShared";

const STEPS = ["home", "lobby", "matchmaking", "champ_select", "loading", "in_game", "post_game"] as const;

/** Chronometre interpole entre deux instantanes (actualises toutes les 2 s). */
export function useGameClock(gameTime: number | null, receivedAt: number) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (gameTime === null) return;
    const id = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(id);
  }, [gameTime]);
  return gameTime === null ? null : gameTime + Math.max(0, Math.min(5, (now - receivedAt) / 1000));
}

export function LivePage() {
  const client = useClient();
  const { navigate } = useNav();
  const { settings, setSetting, notify } = useAppState();
  const caps = platform.capabilities;
  const s = client.state;
  const stage = s?.stage ?? "absent";
  const clock = useGameClock(client.live?.gameTime ?? null, client.liveAt);
  const me = s?.summoner;
  const meId = me ? `${me.gameName}#${me.tagLine}` : "";
  const linked = me && settings.linkedRiotId.toLowerCase() === meId.toLowerCase();

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <Radio aria-hidden="true" /> Partie en direct
        </h1>
        <p className="page-sub">État du client League, sélection des champions et partie en cours, en lecture seule.</p>
      </div>

      {!caps.localClient ? (
        <div className="card">
          <EmptyState title="Disponible dans l'application desktop">Un navigateur ne peut pas accéder au client League installé sur ton PC.</EmptyState>
        </div>
      ) : (
        <>
          <section className="card card-pad stage-card">
            <ol className="stage-line" aria-label="Étapes de la partie">
              {STEPS.map((st) => {
                const idx = STEPS.indexOf(st);
                const cur = STEPS.indexOf(stage as (typeof STEPS)[number]);
                return (
                  <li key={st} data-state={stage === st ? "current" : cur > idx ? "done" : "todo"} aria-current={stage === st ? "step" : undefined}>
                    {STAGE_LABEL[st]}
                  </li>
                );
              })}
            </ol>
            <div className="stage-info">
              <span className="status-dot" data-state={s?.status === "connected" ? "ok" : "off"} />
              {s?.status === "connected" ? (
                <span>
                  Client connecté · <b>{STAGE_LABEL[stage]}</b>
                  {s.phase === "Reconnect" && " (reconnexion à la partie)"}
                  {me && (
                    <>
                      {" "}
                      · {me.gameName}#{me.tagLine} {me.platform ? `(${platformLabel(me.platform)})` : ""} · niv. {me.level}
                    </>
                  )}
                </span>
              ) : (
                <span className="muted">Client League fermé : NEX le détectera automatiquement à son ouverture.</span>
              )}
              <span className="spacer" />
              {me && me.platform && !linked && (
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    await setSetting("linkedRiotId", meId);
                    await setSetting("linkedPlatform", me.platform!);
                    notify("Compte du client lié au dashboard", "success");
                  }}
                >
                  <Link2 /> Lier ce compte
                </button>
              )}
              <button className="btn btn-sm" onClick={() => navigate("overlays")}>
                <LayoutGrid /> Overlays
              </button>
            </div>
          </section>

          {stage === "champ_select" && client.champSelect && <ChampSelectView />}
          {(stage === "in_game" || stage === "loading" || stage === "reconnect") && (
            <section className="card card-pad">
              <div className="live-head">
                <div className="card-title">Partie en cours</div>
                <span className="num live-clock">{clock === null ? "Chargement…" : duration(clock)}</span>
                <span className="spacer" />
                <button
                  className="btn btn-sm"
                  onClick={() => platform.overlayOpen(false).catch((e) => notify(errorMessage(e), "error"))}
                >
                  Afficher l'overlay
                </button>
              </div>
              {client.live ? <Scoreboard players={client.live.players} /> : <p className="muted">En attente des données de la partie (Live Client Data)…</p>}
            </section>
          )}
          {stage === "post_game" && (
            <section className="card">
              <EmptyState title="Partie terminée" action={<button className="btn" onClick={() => navigate("profile")}>Voir l'historique</button>}>
                L'analyse détaillée apparaîtra dans ton historique dès que Riot aura publié la partie (quelques minutes).
              </EmptyState>
            </section>
          )}
        </>
      )}

      <section className="card card-pad sources" style={{ marginTop: 14 }}>
        <div className="panel-label">Sources et limites</div>
        <ul>
          <li>
            <b>Client local (LCU)</b> : étape de la partie (toutes les 4 s), sélection des champions (toutes les 1,5 s). Connexion TLS épinglée sur l'autorité Riot,
            limitée à 127.0.0.1.
          </li>
          <li>
            <b>Live Client Data</b> (port 2999 du jeu) : scores, objets visibles au tableau des scores, temps de jeu (toutes les 2 s, chronomètre interpolé).
          </li>
          <li>
            <b>Données publiques (spectateur)</b> : non utilisées ici. Aucune information cachée (brouillard de guerre, temps de recharge adverses) n'est lue ni déduite.
          </li>
        </ul>
      </section>
    </div>
  );
}

function ChampSelectView() {
  const version = useDDragonVersion();
  const { champSelect } = useClient();
  const { navigate } = useNav();
  const byId = useChampionById();
  if (!champSelect) return null;
  const Team = ({ title, slots, mine }: { title: string; slots: DraftSlotDto[]; mine: boolean }) => (
    <div>
      <div className="panel-label">{title}</div>
      {slots.map((p) => {
        const c = p.championId ? byId(p.championId) : null;
        const isMe = mine && p.cellId === champSelect.localCell;
        return (
          <div key={p.cellId} className={`cs-slot ${isMe ? "me" : ""}`}>
            <PositionIcon position={p.position} size={16} />
            {c ? <ChampIcon version={version} champion={c.key} size={30} rounded={7} /> : <span className="slot-empty" style={{ width: 30, height: 30, borderRadius: 7 }} />}
            <span>
              {c?.name ?? "—"} {p.intent && <span className="muted">(survol)</span>}
            </span>
            <span className="spacer" />
            <span className="muted">{p.position ? ROLE_LABEL[p.position] : ""}</span>
            {isMe && <span className="chip chip-accent">toi</span>}
          </div>
        );
      })}
    </div>
  );
  return (
    <section className="card card-pad">
      <div className="live-head">
        <div className="card-title">Sélection des champions</div>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => navigate("matchups", { tab: "draft" })}>
          <Crosshair /> Ouvrir l'assistant (synchronisé)
        </button>
      </div>
      <div className="cs-teams">
        <Team title="Ton équipe" slots={champSelect.myTeam} mine />
        <Team title="Équipe adverse" slots={champSelect.theirTeam} mine={false} />
      </div>
      {(champSelect.myBans.length > 0 || champSelect.theirBans.length > 0) && (
        <div className="cs-bans">
          <span className="muted">Bannis :</span>
          {[...champSelect.myBans, ...champSelect.theirBans].map((b, i) => (
            <ChampIcon key={i} version={version} champion={byId(b)?.key ?? "Unknown"} size={22} rounded={4} />
          ))}
        </div>
      )}
    </section>
  );
}

function Scoreboard({ players }: { players: LivePlayer[] }) {
  const version = useDDragonVersion();
  const teams = [players.filter((p) => p.team === "ORDER"), players.filter((p) => p.team === "CHAOS")];
  return (
    <div className="scoreboard">
      {teams.map((team, i) => (
        <table key={i} className="team-table">
          <caption className="panel-label" style={{ textAlign: "left" }}>
            {i === 0 ? "Équipe bleue" : "Équipe rouge"}
          </caption>
          <tbody>
            {team.map((p) => (
              <tr key={p.riotId} className={p.isActive ? "me" : ""}>
                <td>
                  <span className="who">
                    <ChampIcon version={version} champion={p.championKey || "Unknown"} size={26} rounded={6} />
                    <span className="who-name">
                      <span>{p.riotId.split("#")[0] || "Joueur"}</span>
                      <span className="muted">niv. {p.level}{p.isDead ? ` · réapparition ${Math.ceil(p.respawnTimer)} s` : ""}</span>
                    </span>
                  </span>
                </td>
                <td className="num">
                  {p.kills}/{p.deaths}/{p.assists}
                </td>
                <td className="num">{p.cs} CS</td>
                <td>
                  <span className="item-row">
                    {p.items.slice(0, 7).map((id, j) => (
                      <ItemIcon key={j} id={id} size={20} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
