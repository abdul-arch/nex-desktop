import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { championName } from "../../data/assets";
import { awardFor } from "../../domain/badges";
import { findParticipant, goldDiffAt15, laneOpponent, teamOf } from "../../domain/fromMatch";
import { kdaOf } from "../../domain/metrics";
import { nexScore } from "../../domain/nexScore";
import { toSummary } from "../../domain/fromMatch";
import type { MatchDto, ParticipantDto } from "../../platform/api";
import { duration, pct, ROLE_LABEL, timeAgo } from "../../ui/format";
import { ChampIcon, ScoreRing, Tip } from "../../ui/primitives";
import { ItemIcon, RuneIcon, SpellIcon } from "./GameIcons";
import { MatchDetail } from "./MatchDetail";

export const QUEUE_NAMES: Record<number, string> = {
  420: "Classée Solo/Duo",
  440: "Classée Flex",
  400: "Normale (draft)",
  430: "Normale (aveugle)",
  480: "Partie rapide",
  490: "Partie rapide",
  450: "ARAM",
  2400: "ARAM Mayhem",
  1700: "Arena",
  1710: "Arena",
  1900: "URF",
  900: "ARURF",
};

const MODE_NAMES: Record<string, string> = {
  CHERRY: "Arena",
  ARAM: "ARAM",
  URF: "URF",
  CLASSIC: "Faille de l'invocateur",
  ONEFORALL: "Un pour tous",
  NEXUSBLITZ: "Nexus Blitz",
};

export function queueName(m: MatchDto): string {
  return QUEUE_NAMES[m.queueId] ?? MODE_NAMES[m.gameMode] ?? `File ${m.queueId}`;
}

function result(m: MatchDto, me: ParticipantDto) {
  if (m.remake) return { key: "remake", label: "Remake" };
  return me.win ? { key: "win", label: "Victoire" } : { key: "loss", label: "Défaite" };
}

export function MatchHistoryRow({
  match,
  puuid,
  lpDelta = null,
  expanded,
  onToggle,
}: {
  match: MatchDto;
  puuid: string;
  /** Variation de LP observée pour cette partie ; null quand elle n'a pas pu être rattachée. */
  lpDelta?: number | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const { catalog } = useAppState();
  const award = useMemo(() => awardFor(match, puuid), [match, puuid]);
  const me = findParticipant(match, puuid);
  if (!me) return null;
  const res = result(match, me);
  const summary = toSummary(match, puuid)!;
  const minutes = match.durationSec / 60;
  const kp = summary.teamKills > 0 ? (me.kills + me.assists) / summary.teamKills : null;
  const score = match.remake ? null : nexScore(summary).score;
  const gd = goldDiffAt15(match, me);
  const opp = laneOpponent(match, me);
  const blue = teamOf(match, 100);
  const red = teamOf(match, 200);
  const champKey = (p: ParticipantDto) => catalog?.champions[String(p.championId)]?.key ?? p.champion;

  return (
    <article className="hist" data-result={res.key}>
      <div className="hist-main" onClick={onToggle}>
        <div className="hist-meta">
          <b className={res.key === "win" ? "win" : res.key === "loss" ? "loss" : "muted"}>
            {res.label}
            {lpDelta !== null && (
              <span className={`lp-delta num ${lpDelta > 0 ? "pos" : lpDelta < 0 ? "neg" : "muted"}`} title="Variation de LP observée entre deux relevés de rang">
                {lpDelta > 0 ? "+" : ""}
                {lpDelta} LP
              </span>
            )}
          </b>
          <span>{queueName(match)}</span>
          <span title={new Date(match.startedAt).toLocaleString("fr-FR")}>{timeAgo(match.startedAt + match.durationSec * 1000)}</span>
          <span className="num">{duration(match.durationSec)}</span>
        </div>

        <div className="hist-champ">
          <span className="hist-champ-icon">
            <ChampIcon version={version} champion={champKey(me)} size={46} rounded={10} />
            <span className="lvl num">{me.championLevel}</span>
          </span>
          <span className="hist-spells">
            <SpellIcon id={me.spells[0]} />
            <SpellIcon id={me.spells[1]} />
          </span>
          <span className="hist-spells">
            <RuneIcon id={me.keystone} />
            <RuneIcon id={me.secondaryStyle} size={16} />
          </span>
        </div>

        <div className="hist-kda">
          <b className="num">
            {me.kills} / <span className="loss">{me.deaths}</span> / {me.assists}
          </b>
          <span className="num">{me.deaths === 0 ? "Sans mort" : `${kdaOf(me.kills, me.deaths, me.assists).toFixed(2)} KDA`}</span>
          <span className="num">KP {pct(kp)}</span>
        </div>

        <div className="hist-stats num">
          <span>
            {me.cs} CS <span className="muted">({minutes > 0 ? (me.cs / minutes).toFixed(1) : "—"}/min)</span>
          </span>
          <span>
            {Math.round(me.damageToChampions / 100) / 10}k dégâts <span className="muted">· vision {me.visionScore}</span>
          </span>
          <Tip text={gd === null ? "Écart d'or à 15:00 : timeline non chargée ou pas d'adversaire direct" : `Écart d'or à 15:00 vs ${opp ? championName(champKey(opp)) : "adversaire"}`}>
            <span tabIndex={0}>
              GD@15{" "}
              <span className={gd === null ? "muted" : gd >= 0 ? "pos" : "neg"}>{gd === null ? "—" : `${gd > 0 ? "+" : ""}${gd}`}</span>
            </span>
          </Tip>
        </div>

        <div className="hist-items">
          <span className="item-row">
            {me.items.slice(0, 6).map((id, i) => (
              <ItemIcon key={i} id={id} size={24} />
            ))}
            <ItemIcon id={me.items[6]} size={24} trinket />
          </span>
          {award && award.badges.length > 0 && (
            <span className="badges">
              {award.badges.slice(0, 2).map((b) => (
                <span key={b.id} title={b.detail}>
                  {b.label}
                </span>
              ))}
            </span>
          )}
        </div>

        <div className="hist-teams">
          {(blue.length + red.length === match.participants.length && blue.length > 0 && red.length > 0 ? [blue, red] : []).map((team, ti) => (
            <div key={ti} aria-label={ti === 0 ? "Équipe bleue" : "Équipe rouge"}>
              {team.map((p) => (
                <span key={p.participantId} className={p.puuid === puuid ? "me" : ""}>
                  <ChampIcon version={version} champion={champKey(p)} size={15} rounded={3} />
                  {p.gameName && p.tagLine ? (
                    <button
                      className="pname"
                      title={`${p.gameName}#${p.tagLine}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate("profile", { riotId: `${p.gameName}#${p.tagLine}`, platform: match.platform });
                      }}
                    >
                      {p.gameName}
                    </button>
                  ) : (
                    <span className="pname muted">Joueur masqué</span>
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>

        <ScoreRing value={score} label="Score NEX" size={36} rank={award?.rankLabel ?? null} />
        <button
          className="icon-btn hist-toggle"
          aria-expanded={expanded}
          aria-label={`${res.label}, ${championName(champKey(me))}, ${me.kills}/${me.deaths}/${me.assists} : ${expanded ? "masquer" : "afficher"} le détail`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      {expanded && <MatchDetail match={match} puuid={puuid} />}
    </article>
  );
}

export function roleLabel(position: string | null) {
  return position ? ROLE_LABEL[position] ?? position : "—";
}
