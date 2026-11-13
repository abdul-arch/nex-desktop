import { useMemo, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { championName, objectiveIcon } from "../../data/assets";
import {
  MAYHEM_QUEUE,
  findParticipant,
  toSummary,
  groupPurchases,
  purchaseOrder,
  skillLabel,
  skillOrder,
} from "../../domain/fromMatch";
import { matchAwards } from "../../domain/badges";
import { allSeries, story, teamSeries } from "../../domain/fights";
import { kdaOf } from "../../domain/metrics";
import { nexScore } from "../../domain/nexScore";
import { platform } from "../../platform";
import type { MatchDto, ParticipantDto, TeamDto, TimelineDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { LineChart } from "../../ui/LineChart";
import { duration, pct, ROLE_LABEL } from "../../ui/format";
import { ChampIcon, ScoreRing, Segmented } from "../../ui/primitives";
import { ItemIcon, RuneIcon, SpellIcon, statShardLabel } from "./GameIcons";

const mmss = (ms: number) => duration(Math.floor(ms / 1000));

export function MatchDetail({ match, puuid }: { match: MatchDto; puuid: string }) {
  const [tab, setTab] = useState<"teams" | "gold" | "story" | "build">("teams");
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
              { value: "gold", label: "Or" },
              { value: "story", label: "Chronologie" },
              { value: "build", label: "Build & runes" },
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
  const teamDamage = players.reduce((a, p) => a + p.damageToChampions, 0);
  const maxTaken = Math.max(1, ...match.participants.map((p) => p.damageTaken));
  const awards = matchAwards(match);
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
            <th scope="col">Subis</th>
            <th scope="col">Or</th>
            <th scope="col">CS</th>
            <th scope="col">Vision</th>
            <th scope="col">Objets</th>
            <th scope="col">Score</th>
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
                <div className="dmg-bar" title={`${pct(teamDamage > 0 ? p.damageToChampions / teamDamage : null)} des dégâts de l'équipe`}>
                  <i style={{ width: `${(p.damageToChampions / maxDmg) * 100}%` }} />
                </div>
                <div className="muted">{pct(teamDamage > 0 ? p.damageToChampions / teamDamage : null)} de l'équipe</div>
              </td>
              <td className="num">
                {p.damageTaken.toLocaleString("fr-FR")}
                <div className="dmg-bar taken">
                  <i style={{ width: `${(p.damageTaken / maxTaken) * 100}%` }} />
                </div>
              </td>
              <td className="num">
                {(p.goldEarned / 1000).toFixed(1)}k
                <div className="muted">{match.durationSec > 0 ? Math.round(p.goldEarned / (match.durationSec / 60)) : "—"}/min</div>
              </td>
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
                {awards.get(p.participantId)?.badges.length ? (
                  <span className="badges" style={{ marginTop: 4 }}>
                    {awards
                      .get(p.participantId)!
                      .badges.slice(0, 2)
                      .map((b) => (
                        <span key={b.id} title={b.detail}>
                          {b.label}
                        </span>
                      ))}
                  </span>
                ) : null}
              </td>
              <td>
                <ScoreRing
                  value={scoreOf(match, p)}
                  label="Score NEX"
                  size={30}
                  rank={awards.get(p.participantId)?.rankLabel ?? null}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Score NEX d'un participant quelconque de la partie, null quand il n'est pas calculable. */
function scoreOf(match: MatchDto, p: ParticipantDto): number | null {
  const summary = toSummary(match, p.puuid);
  return summary ? nexScore(summary).score : null;
}

function TimelineViews({ match, puuid, view }: { match: MatchDto; puuid: string; view: "gold" | "story" | "build" }) {
  const tl = useAsync<TimelineDto>(`timeline:${match.id}`, () => platform.matchTimeline(match.platform, match.id), 10 * 60_000);
  const me = findParticipant(match, puuid);
  // Joueur affiche dans l'onglet Build : soi-meme par defaut, n'importe lequel des dix ensuite.
  const [shownId, setShownId] = useState<number | null>(null);
  if (!me) return null;
  const shown = match.participants.find((p) => p.participantId === shownId) ?? me;
  return (
    <>
      {view === "build" && <PlayerPicker match={match} shown={shown} onPick={setShownId} />}
      {view === "build" && <RunesPanel me={shown} />}
      {tl.loading && !tl.data && <div className="muted" style={{ padding: 12 }}>Chargement de la timeline…</div>}
      {tl.error != null && <ErrorPanel error={tl.error} onRetry={() => tl.reload()} compact />}
      {tl.data && view === "build" && <BuildPanel t={tl.data} me={shown} />}
      {view === "build" && <PlayerDetails match={match} p={shown} t={tl.data} />}
      {tl.data && view === "gold" && <GoldPanel t={tl.data} match={match} me={me} />}
      {tl.data && view === "story" && <StoryPanel t={tl.data} match={match} me={me} />}
    </>
  );
}

/** Les dix champions de la partie, pour choisir de qui on regarde le build. */
function PlayerPicker({ match, shown, onPick }: { match: MatchDto; shown: ParticipantDto; onPick: (id: number) => void }) {
  const { catalog } = useAppState();
  const version = useDDragonVersion();
  const key = (p: ParticipantDto) => catalog?.champions[String(p.championId)]?.key ?? p.champion;
  return (
    <div className="player-picker">
      {match.participants.map((p) => (
        <button
          key={p.participantId}
          className={p.participantId === shown.participantId ? "active" : ""}
          data-team={p.teamId}
          onClick={() => onPick(p.participantId)}
          aria-pressed={p.participantId === shown.participantId}
          title={`${p.gameName || "Joueur masqué"} — ${championName(key(p))}`}
        >
          <ChampIcon version={version} champion={key(p)} size={26} rounded={6} />
        </button>
      ))}
      <span className="muted player-picker-name">
        {shown.gameName || "Joueur masqué"} · {championName(key(shown))}
      </span>
    </div>
  );
}

/**
 * Chiffres que le tableau des equipes ne montre pas. Une ligne dont Riot ne fournit pas la
 * donnee n'est pas affichee, plutot que montree a zero.
 */
function PlayerDetails({ match, p, t }: { match: MatchDto; p: ParticipantDto; t: TimelineDto | null }) {
  const at15 = useMemo(() => {
    if (!t) return null;
    const opp = match.participants.find((o) => o.teamId !== p.teamId && o.position === p.position);
    const frame = t.frames.find((f) => Math.abs(f.timestamp - 900_000) < 30_000);
    if (!opp || !frame) return null;
    const mine = frame.players.find((x) => x.participantId === p.participantId);
    const his = frame.players.find((x) => x.participantId === opp.participantId);
    return mine && his ? { gold: mine.totalGold - his.totalGold, xp: mine.xp - his.xp, cs: mine.cs - his.cs } : null;
  }, [match, p, t]);

  const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR")}`;
  const rows: [string, string][] = [];
  rows.push(["Balises", `${p.wardsPlaced} posées · ${p.wardsKilled} détruites${p.detectorWardsPlaced !== null ? ` · ${p.detectorWardsPlaced} de contrôle` : ""}`]);
  if (p.ccTimeSec !== null) rows.push(["Contrôle de foule", `${p.ccTimeSec} s`]);
  if (p.damageToObjectives !== null)
    rows.push(["Dégâts aux objectifs", `${p.damageToObjectives.toLocaleString("fr-FR")}${p.damageToTurrets !== null ? ` · ${p.damageToTurrets.toLocaleString("fr-FR")} aux tours` : ""}`]);
  if (p.largestKillingSpree !== null) rows.push(["Plus longue série", String(p.largestKillingSpree)]);
  if (p.largestMultiKill > 1) rows.push(["Plus grand multi-kill", MULTI_LABEL[p.largestMultiKill] ?? `${p.largestMultiKill} d'affilée`]);
  if (p.timeDeadSec !== null) rows.push(["Temps passé mort", duration(p.timeDeadSec)]);
  if (at15) rows.push(["Avance à 15 min", `${signed(at15.gold)} or · ${signed(at15.xp)} XP · ${signed(at15.cs)} CS`]);

  return (
    <div className="player-details">
      <div className="panel-label">Détails</div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
      {!t && <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>L'avance à 15 minutes demande la timeline, en cours de chargement.</p>}
    </div>
  );
}

const MULTI_LABEL: Record<number, string> = {
  2: "Double élimination",
  3: "Triple élimination",
  4: "Quadruple élimination",
  5: "Pentakill",
};

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

const MONSTER_FR: Record<string, string> = {
  DRAGON: "Dragon",
  BARON_NASHOR: "Baron Nashor",
  RIFTHERALD: "Héraut de la Faille",
  HORDE: "Larve du Néant",
  ATAKHAN: "Atakhan",
};

/** Or, XP ou CS des deux equipes au fil de la partie, puis le detail par joueur. */
function GoldPanel({ t, match, me }: { t: TimelineDto; match: MatchDto; me: ParticipantDto }) {
  const [field, setField] = useState<"gold" | "xp" | "cs">("gold");
  const { catalog } = useAppState();
  const version = useDDragonVersion();
  const teams = useMemo(() => teamSeries(match, t, field), [match, t, field]);
  const perPlayer = useMemo(() => allSeries(t), [t]);
  if (teams.length < 2) return <div className="muted" style={{ padding: 12 }}>Pas assez de points dans la timeline.</div>;

  const unit = (v: number) => (field === "cs" ? String(Math.round(v)) : `${(v / 1000).toFixed(1)}k`);
  const lead = teams.map((f) => f.blue - f.red);
  const sign = me.teamId === 100 ? 1 : -1;
  const last = teams[teams.length - 1];
  const label = field === "gold" ? "Or" : field === "xp" ? "XP" : "CS";
  const players = match.participants
    .map((p) => {
      const serie = perPlayer.get(p.participantId) ?? [];
      return { p, value: serie.length ? serie[serie.length - 1][field] : 0 };
    })
    .sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...players.map((x) => x.value));
  const finalLead = lead[lead.length - 1] * sign;

  return (
    <div className="gold-panel">
      <Segmented
        label="Mesure"
        options={[
          { value: "gold", label: "Or" },
          { value: "xp", label: "XP" },
          { value: "cs", label: "CS" },
        ]}
        value={field}
        onChange={setField}
      />
      <div className="gold-totals num">
        <span className="win">Équipe bleue {unit(last.blue)}</span>
        <span className="loss">Équipe rouge {unit(last.red)}</span>
        <span className={finalLead >= 0 ? "pos" : "neg"}>
          Ton équipe {finalLead >= 0 ? "+" : "−"}
          {unit(Math.abs(finalLead))}
        </span>
      </div>
      <LineChart
        ariaLabel={`${label} cumulé de chaque équipe`}
        series={[
          { label: "Équipe bleue", color: "var(--blue)", values: teams.map((f) => f.blue) },
          { label: "Équipe rouge", color: "var(--red)", values: teams.map((f) => f.red) },
        ]}
        xLabel={(i) => `${teams[i]?.minute ?? i} min`}
        yFormat={unit}
      />
      <div className="panel-label">Avance de l'équipe bleue</div>
      <LineChart
        ariaLabel="Avance de l'équipe bleue"
        height={110}
        zeroLine
        series={[{ label: "Avance bleue", color: "var(--accent)", values: lead }]}
        xLabel={(i) => `${teams[i]?.minute ?? i} min`}
        yFormat={(v) => `${v > 0 ? "+" : ""}${unit(v)}`}
      />
      <div className="panel-label">{label} par joueur, en fin de partie</div>
      <ul className="gold-players">
        {players.map(({ p, value }) => (
          <li key={p.participantId} className={p.participantId === me.participantId ? "me" : ""} data-team={p.teamId}>
            <ChampIcon version={version} champion={catalog?.champions[String(p.championId)]?.key ?? p.champion} size={20} rounded={5} />
            <span className="gold-name">{p.gameName || championName(p.champion)}</span>
            <span className="gold-bar">
              <i style={{ width: `${(value / max) * 100}%` }} />
            </span>
            <span className="num">{unit(value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Deroule de la partie : combats, objectifs et batiments, dans l'ordre. */
function StoryPanel({ t, match, me }: { t: TimelineDto; match: MatchDto; me: ParticipantDto }) {
  const [mineOnly, setMineOnly] = useState(false);
  const { catalog } = useAppState();
  const version = useDDragonVersion();
  const entries = useMemo(() => story(match, t), [match, t]);
  const byId = new Map(match.participants.map((p) => [p.participantId, p]));
  const champ = (id: number | null | undefined) => {
    const p = id ? byId.get(id) : undefined;
    return p ? catalog?.champions[String(p.championId)]?.key ?? p.champion : null;
  };
  const involved = (e: (typeof entries)[number]) =>
    !!e.fight?.kills.some((k) => k.killerId === me.participantId || k.victimId === me.participantId || k.assistingIds.includes(me.participantId));
  const shown = mineOnly ? entries.filter(involved) : entries;
  const myTeam = me.teamId;
  const other = myTeam === 100 ? 200 : 100;
  const sign = myTeam === 100 ? 1 : -1;

  return (
    <div className="story-panel">
      <Segmented
        label="Filtre"
        options={[
          { value: "all", label: "Toute la partie" },
          { value: "mine", label: "Tes actions" },
        ]}
        value={mineOnly ? "mine" : "all"}
        onChange={(v) => setMineOnly(v === "mine")}
      />
      {shown.length === 0 ? (
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Aucune action retenue sur ce filtre.
        </p>
      ) : (
        <ol className="story-list">
          {shown.map((e, i) => {
            const nous = e.fight?.deathsByTeam.get(other) ?? 0;
            const eux = e.fight?.deathsByTeam.get(myTeam) ?? 0;
            return (
              <li key={i} className={e.fight ? (nous > eux ? "won" : nous < eux ? "lost" : "") : ""}>
                <span className="num story-at">{mmss(e.at)}</span>
                <span className="story-body">
                  <b>
                    {e.kind === "fight"
                      ? e.teamfight
                        ? "Combat d'équipe"
                        : "Escarmouche"
                      : e.kind === "monster"
                        ? MONSTER_FR[e.monsterType ?? ""] ?? e.monsterType ?? "Monstre épique"
                        : "Bâtiment détruit"}
                  </b>
                  {e.fight && (
                    <span className="num story-count">
                      {nous} – {eux} · {Math.max(1, Math.round((e.fight.endsAt - e.fight.at) / 1000))} s
                    </span>
                  )}
                  {e.kind !== "fight" && e.teamId !== undefined && (
                    <span className="muted">
                      {e.kind === "building"
                        ? e.teamId === myTeam
                          ? "à ton équipe"
                          : "à l'équipe adverse"
                        : e.teamId === myTeam
                          ? "pour ton équipe"
                          : "pour l'équipe adverse"}
                    </span>
                  )}
                  {e.fight && (
                    <span className="story-kills">
                      {e.fight.kills.slice(0, 8).map((k, j) => {
                        const killer = champ(k.killerId);
                        const victim = champ(k.victimId);
                        return (
                          <span key={j} title={`${killer ? championName(killer) : "Exécution"} élimine ${victim ? championName(victim) : "?"}`}>
                            {killer && <ChampIcon version={version} champion={killer} size={18} rounded={4} />}
                            <i aria-hidden="true">›</i>
                            {victim && <ChampIcon version={version} champion={victim} size={18} rounded={4} />}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </span>
                <span className="num story-score">
                  {e.score.get(myTeam) ?? 0} – {e.score.get(other) ?? 0}
                  {e.goldLead !== null && (
                    <small className={e.goldLead * sign >= 0 ? "pos" : "neg"}>
                      {e.goldLead * sign >= 0 ? "+" : "−"}
                      {(Math.abs(e.goldLead) / 1000).toFixed(1)}k
                    </small>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "8px 0 0" }}>
        Les éliminations séparées de moins de 10 secondes sont comptées comme un même affrontement. La timeline de Riot ne donne pas la position des
        événements : deux escarmouches simultanées aux deux bouts de la carte apparaîtraient comme un seul combat.
      </p>
    </div>
  );
}
