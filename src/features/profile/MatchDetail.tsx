import { useMemo, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { championName, objectiveIcon } from "../../data/assets";
import {
  MAYHEM_QUEUE,
  findParticipant,
  groupPurchases,
  laneOpponent,
  perMinuteSeries,
  purchaseOrder,
  skillLabel,
  skillOrder,
} from "../../domain/fromMatch";
import { kdaOf } from "../../domain/metrics";
import { platform } from "../../platform";
import type { MatchDto, ParticipantDto, TeamDto, TimelineDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { LineChart } from "../../ui/LineChart";
import { duration, ROLE_LABEL } from "../../ui/format";
import { ChampIcon, Segmented } from "../../ui/primitives";
import { ItemIcon, RuneIcon, SpellIcon, statShardLabel } from "./GameIcons";

const mmss = (ms: number) => duration(Math.floor(ms / 1000));

export function MatchDetail({ match, puuid }: { match: MatchDto; puuid: string }) {
  const [tab, setTab] = useState<"teams" | "timeline" | "build">("teams");
  // ARAM Mayhem : partie lue dans le client League. Riot n'en fournit pas la timeline, et le
  // mode n'a pas de runes : seule la vue des équipes existe.
  const localOnly = match.queueId === MAYHEM_QUEUE;
  return (
    <div className="hist-detail">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        {!localOnly && (
          <Segmented
            label="Vue du match"
            options={[
              { value: "teams", label: "Équipes" },
              { value: "build", label: "Build & runes" },
              { value: "timeline", label: "Timeline" },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}
        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          {match.id} · patch {match.gameVersion.split(".").slice(0, 2).join(".")} · {new Date(match.startedAt).toLocaleString("fr-FR")}
          {localOnly && " · lue dans le client League (Riot ne fournit ni la timeline ni l'ordre d'achat de ce mode)"}
        </span>
      </div>
      {(localOnly || tab === "teams") && <Teams match={match} puuid={puuid} />}
      {!localOnly && tab !== "teams" && <TimelineViews match={match} puuid={puuid} view={tab} />}
    </div>
  );
}

function Teams({ match, puuid }: { match: MatchDto; puuid: string }) {
  const teamIds = [...new Set(match.participants.map((p) => p.teamId))].sort((a, b) => a - b);
  const maxDmg = Math.max(1, ...match.participants.map((p) => p.damageToChampions));
  return (
    <div className="teams">
      {teamIds.map((tid) => {
        const team = match.teams.find((t) => t.teamId === tid);
        const players = match.participants.filter((p) => p.teamId === tid);
        return (
          <TeamTable key={tid} match={match} team={team} players={players} puuid={puuid} maxDmg={maxDmg} />
        );
      })}
    </div>
  );
}

function teamName(id: number) {
  return id === 100 ? "Équipe bleue" : id === 200 ? "Équipe rouge" : `Équipe ${id}`;
}

function TeamTable({
  match,
  team,
  players,
  puuid,
  maxDmg,
}: {
  match: MatchDto;
  team: TeamDto | undefined;
  players: ParticipantDto[];
  puuid: string;
  maxDmg: number;
}) {
  const version = useDDragonVersion();
  const { catalog } = useAppState();
  const { navigate } = useNav();
  const win = team?.win ?? players[0]?.win;
  const kills = players.reduce((a, p) => a + p.kills, 0);
  const gold = players.reduce((a, p) => a + p.goldEarned, 0);
  const key = (p: ParticipantDto) => catalog?.champions[String(p.championId)]?.key ?? p.champion;
  const isRift = match.participants.some((p) => p.position);
  const o = team?.objectives;

  return (
    <section className="team-block" data-team={team?.teamId}>
      <header>
        <b className={match.remake ? "muted" : win ? "win" : "loss"}>{match.remake ? "Remake" : win ? "Victoire" : "Défaite"}</b>
        <span>{teamName(players[0]?.teamId ?? 0)}</span>
        <span className="num muted">
          {kills} élim. · {(gold / 1000).toFixed(1)}k or
        </span>
        <span className="spacer" />
        {o && isRift && (
          <span className="objectives num">
            {(
              [
                ["tower", "Tours", o.tower],
                ["inhibitor", "Inhibiteurs", o.inhibitor],
                ["dragon", "Dragons", o.dragon],
                ["baron", "Barons", o.baron],
                ["herald", "Hérauts", o.herald],
              ] as const
            ).map(([kind, label, n]) => (
              <span key={kind} title={label}>
                <img src={objectiveIcon(kind, team?.teamId ?? 100) ?? undefined} alt={label} width={16} height={16} loading="lazy" />
                <b>{n}</b>
              </span>
            ))}
            <span title="Larves du Néant">
              Larves <b>{o.horde}</b>
            </span>
          </span>
        )}
        {team && team.bans.filter((b) => b > 0).length > 0 && (
          <span className="bans" aria-label="Bannissements">
            {team.bans
              .filter((b) => b > 0)
              .map((b, i) => {
                const c = catalog?.champions[String(b)];
                return (
                  <span key={i} className="ban" title={`Banni : ${c?.name ?? b}`}>
                    <ChampIcon version={version} champion={c?.key ?? "Unknown"} size={18} rounded={4} />
                  </span>
                );
              })}
          </span>
        )}
      </header>
      <table className="team-table">
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            {isRift && <th scope="col">Rôle</th>}
            <th scope="col">KDA</th>
            <th scope="col">Dégâts</th>
            <th scope="col">Or</th>
            <th scope="col">CS</th>
            <th scope="col">Vision</th>
            <th scope="col">Objets</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.participantId} className={p.puuid === puuid ? "me" : ""}>
              <td>
                <span className="who">
                  <ChampIcon version={version} champion={key(p)} size={28} rounded={6} />
                  <span className="who-spells">
                    <SpellIcon id={p.spells[0]} size={13} />
                    <SpellIcon id={p.spells[1]} size={13} />
                  </span>
                  <span className="who-spells">
                    <RuneIcon id={p.keystone} size={13} />
                    <RuneIcon id={p.secondaryStyle} size={13} />
                  </span>
                  <span className="who-name">
                    {p.gameName && p.tagLine ? (
                      <button className="pname" onClick={() => navigate("profile", { riotId: `${p.gameName}#${p.tagLine}`, platform: match.platform })}>
                        {p.gameName}
                      </button>
                    ) : (
                      <span className="muted">Joueur masqué</span>
                    )}
                    <span className="muted">
                      {championName(key(p))} · niv. {p.championLevel}
                    </span>
                  </span>
                </span>
              </td>
              {isRift && <td>{p.position ? ROLE_LABEL[p.position] ?? p.position : "—"}</td>}
              <td className="num">
                {p.kills}/{p.deaths}/{p.assists}
                <div className="muted">{p.deaths === 0 ? "Sans mort" : kdaOf(p.kills, p.deaths, p.assists).toFixed(1)}</div>
              </td>
              <td className="num">
                {p.damageToChampions.toLocaleString("fr-FR")}
                <div className="dmg-bar">
                  <i style={{ width: `${(p.damageToChampions / maxDmg) * 100}%` }} />
                </div>
              </td>
              <td className="num">{(p.goldEarned / 1000).toFixed(1)}k</td>
              <td className="num">
                {p.cs}
                <div className="muted">{match.durationSec > 0 ? (p.cs / (match.durationSec / 60)).toFixed(1) : "—"}/min</div>
              </td>
              <td className="num">
                {p.visionScore}
                <div className="muted" title="Balises posées / détruites">
                  {p.wardsPlaced}/{p.wardsKilled}
                </div>
              </td>
              <td>
                <span className="item-row">
                  {p.items.slice(0, 6).map((id, i) => (
                    <ItemIcon key={i} id={id} size={20} />
                  ))}
                  <ItemIcon id={p.items[6]} size={20} trinket />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TimelineViews({ match, puuid, view }: { match: MatchDto; puuid: string; view: "timeline" | "build" }) {
  const tl = useAsync<TimelineDto>(`timeline:${match.id}`, () => platform.matchTimeline(match.platform, match.id), 10 * 60_000);
  const me = findParticipant(match, puuid);
  if (!me) return null;
  return (
    <>
      {view === "build" && <RunesPanel me={me} />}
      {tl.loading && !tl.data && <div className="muted" style={{ padding: 12 }}>Chargement de la timeline…</div>}
      {tl.error != null && <ErrorPanel error={tl.error} onRetry={() => tl.reload()} compact />}
      {tl.data && (view === "build" ? <BuildPanel t={tl.data} me={me} /> : <CurvesPanel t={tl.data} match={match} me={me} />)}
    </>
  );
}

function RunesPanel({ me }: { me: ParticipantDto }) {
  const { catalog } = useAppState();
  const primary = me.perks.slice(0, 4);
  const secondary = me.perks.slice(4);
  return (
    <div className="runes-panel">
      <div>
        <div className="panel-label">
          <RuneIcon id={me.primaryStyle} size={18} /> {catalog?.runes[String(me.primaryStyle)]?.name ?? "Arbre principal"}
        </div>
        <div className="rune-list">
          {primary.map((id, i) => (
            <span key={id}>
              <RuneIcon id={id} size={i === 0 ? 34 : 26} />
              <small>{catalog?.runes[String(id)]?.name ?? id}</small>
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="panel-label">
          <RuneIcon id={me.secondaryStyle} size={18} /> {catalog?.runes[String(me.secondaryStyle)]?.name ?? "Arbre secondaire"}
        </div>
        <div className="rune-list">
          {secondary.map((id) => (
            <span key={id}>
              <RuneIcon id={id} size={26} />
              <small>{catalog?.runes[String(id)]?.name ?? id}</small>
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="panel-label">Fragments</div>
        <ul className="shards">
          {me.statPerks.map((s, i) => (
            <li key={i}>{statShardLabel(s)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function BuildPanel({ t, me }: { t: TimelineDto; me: ParticipantDto }) {
  const { settings } = useAppState();
  const groups = useMemo(() => groupPurchases(purchaseOrder(t, me.participantId)), [t, me.participantId]);
  const skills = useMemo(() => skillOrder(t, me.participantId), [t, me.participantId]);
  return (
    <div className="build-panel">
      <div>
        <div className="panel-label">Ordre d'achat (timeline)</div>
        {groups.length === 0 ? (
          <div className="muted">Aucun achat enregistré.</div>
        ) : (
          <ol className="purchase-groups">
            {groups.map((g, i) => (
              <li key={i}>
                <span className="muted num">{mmss(g[0].timestamp)}</span>
                <span className="item-row">
                  {g.map((s, j) => (
                    <span key={j} className={s.kind === "sell" ? "sold" : ""} title={s.kind === "sell" ? "Vendu" : undefined}>
                      <ItemIcon id={s.itemId} size={24} />
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>
          Achats réels, annulations retirées, ventes barrées. L'inventaire final est affiché dans l'onglet Équipes.
        </p>
      </div>
      <div>
        <div className="panel-label">Ordre des compétences</div>
        {skills.length === 0 ? (
          <div className="muted">Aucune donnée.</div>
        ) : (
          <table className="skill-grid" aria-label="Ordre des compétences">
            <tbody>
              {[1, 2, 3, 4].map((slot) => (
                <tr key={slot}>
                  <th scope="row">{skillLabel(slot, settings.abilityKeys)}</th>
                  {Array.from({ length: Math.max(18, skills.length) }, (_, lvl) => (
                    <td key={lvl} className={skills[lvl] === slot ? "on" : ""}>
                      {skills[lvl] === slot ? lvl + 1 : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CurvesPanel({ t, match, me }: { t: TimelineDto; match: MatchDto; me: ParticipantDto }) {
  const { catalog } = useAppState();
  const opp = laneOpponent(match, me);
  const mine = perMinuteSeries(t, me.participantId);
  const theirs = opp ? perMinuteSeries(t, opp.participantId) : null;
  const oppName = opp ? championName(catalog?.champions[String(opp.championId)]?.key ?? opp.champion) : null;
  const goldDiff = theirs
    ? mine.map((m, i) => (m.gold !== null && theirs[i]?.gold != null ? m.gold - (theirs[i].gold as number) : null))
    : null;
  const keyEvents = t.events.filter(
    (e) =>
      (e.kind === "champion_kill" && (e.participantId === me.participantId || e.victimId === me.participantId)) ||
      e.kind === "elite_monster_kill",
  );
  const label = (e: (typeof keyEvents)[number]) => {
    if (e.kind === "elite_monster_kill") {
      const names: Record<string, string> = { DRAGON: "Dragon", BARON_NASHOR: "Baron", RIFTHERALD: "Héraut", HORDE: "Larve du Néant", ATAKHAN: "Atakhan" };
      const killer = match.participants.find((p) => p.participantId === e.participantId);
      const team = e.teamId ?? killer?.teamId;
      return `${names[e.monsterType ?? ""] ?? e.monsterType} — ${team === me.teamId ? "ton équipe" : "équipe adverse"}`;
    }
    return e.participantId === me.participantId ? "Élimination" : "Mort";
  };
  return (
    <div className="curves-panel">
      <div>
        <div className="panel-label">{goldDiff ? `Écart d'or vs ${oppName}` : "Or total"}</div>
        <LineChart
          ariaLabel="Courbe d'or"
          zeroLine={!!goldDiff}
          series={
            goldDiff
              ? [{ label: `Écart d'or (toi − ${oppName})`, color: "var(--gold)", values: goldDiff }]
              : [{ label: "Or total", color: "var(--gold)", values: mine.map((m) => m.gold) }]
          }
          xLabel={(i) => `${mine[i]?.minute ?? i}'`}
          yFormat={(v) => `${v > 0 && goldDiff ? "+" : ""}${(v / 1000).toFixed(1)}k`}
        />
      </div>
      <div>
        <div className="panel-label">CS cumulés</div>
        <LineChart
          ariaLabel="Courbe de CS"
          series={[
            { label: "Toi", color: "var(--blue)", values: mine.map((m) => m.cs) },
            ...(theirs && oppName ? [{ label: oppName, color: "var(--red)", values: theirs.map((m) => m.cs), dashed: true }] : []),
          ]}
          xLabel={(i) => `${mine[i]?.minute ?? i}'`}
        />
      </div>
      <div className="key-events">
        <div className="panel-label">Événements clés</div>
        <ul>
          {keyEvents.slice(0, 40).map((e, i) => (
            <li key={i} className={e.kind === "champion_kill" ? (e.participantId === me.participantId ? "pos" : "neg") : ""}>
              <span className="num muted">{mmss(e.timestamp)}</span> {label(e)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
