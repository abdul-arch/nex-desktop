// Joueurs pro d'une equipe : une carte par joueur (son compte le mieux classe), puis une fiche
// avec tous ses comptes declares et ses parties classees des deux dernieres semaines.
//
// Comptes et affiliations : Leaguepedia. Rang, LP et parties : Riot. Ni photo de joueur ni
// logo d'equipe (droits non couverts) : icone d'invocateur du compte et initiales de l'equipe.
import { ChevronLeft, ExternalLink, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { championName, profileIcon } from "../../data/assets";
import { toSummary } from "../../domain/fromMatch";
import { rankValue } from "../../domain/playerSample";
import type { MatchSummary } from "../../domain/types";
import { platform } from "../../platform";
import type { MatchPageDto, PlayerProfileDto, ProPlayerDto, ProTeamDto, RankDto } from "../../platform/api";
import { pct, ROLE_LABEL, timeAgo } from "../../ui/format";
import { ChampIcon, PositionIcon, RankCrest, RemoteImg } from "../../ui/primitives";
import { RegionTag, TIER_COLOR, fr, kdaText, proRole, teamMark, tierText } from "./shared";

export type AccountState = PlayerProfileDto | "notfound" | "error";

/** Un compte declare d'un joueur, avec sa lecture Riot (undefined : pas encore lue). */
export interface TeamAccount {
  key: string;
  player: ProPlayerDto;
  account: { riotId: string; platform: string };
  state: AccountState | undefined;
  /** Rang dans la file affichee : null si non classe, undefined si pas encore connu. */
  rank: RankDto | null | undefined;
}

const profileOf = (a: TeamAccount) => (a.state && typeof a.state === "object" ? a.state : null);
const splitRiotId = (id: string) => {
  const i = id.lastIndexOf("#");
  return i < 0 ? [id, ""] : [id.slice(0, i), id.slice(i + 1)];
};

/** Comptes d'un joueur, le mieux classe en premier, puis les non classes. */
function sortAccounts(list: TeamAccount[]): TeamAccount[] {
  return [...list].sort((x, y) => rankValue(y.rank ?? null) - rankValue(x.rank ?? null));
}

function AccountIcon({ a, size }: { a: TeamAccount | undefined; size: number }) {
  const version = useDDragonVersion();
  const icon = a ? profileOf(a)?.profileIconId : undefined;
  return (
    <span className="lb-avatar" style={{ width: size, height: size }}>
      {icon != null && <RemoteImg src={profileIcon(version, icon)} alt="" fallback="" />}
    </span>
  );
}

// ---------- Cartes des joueurs ----------

export function PlayerCards({ team, accounts, onOpen }: { team: ProTeamDto; accounts: TeamAccount[]; onOpen: (player: string) => void }) {
  const players = useMemo(() => {
    const list = team.players
      .filter((p) => p.accounts.length)
      .map((p) => {
        const own = sortAccounts(accounts.filter((a) => a.player.name === p.name));
        const best = own.find((a) => a.rank) ?? null;
        const pending = own.some((a) => a.state === undefined);
        return { p, own, best, pending };
      });
    return list.sort((x, y) => rankValue(y.best?.rank ?? null) - rankValue(x.best?.rank ?? null));
  }, [team, accounts]);

  return (
    <div className="pp-cards">
      {players.map(({ p, own, best, pending }, i) => {
        const r = best?.rank;
        const games = r ? r.wins + r.losses : 0;
        const role = proRole(p.role);
        return (
          <button
            key={p.name}
            className="pp-card"
            style={{ ["--tier" as string]: r ? (TIER_COLOR[r.tier] ?? "var(--blue)") : "var(--border)" }}
            onClick={() => onOpen(p.name)}
            aria-label={`Ouvrir la fiche de ${p.name}`}
          >
            <span className="pp-badge" aria-hidden="true">
              <span className="pp-mark">{teamMark(team.name)}</span>
              <b className="num">{r ? `#${i + 1}` : "—"}</b>
            </span>
            <AccountIcon a={best ?? own[0]} size={64} />
            {r ? (
              <>
                <span className="pp-lp">
                  <RankCrest tier={r.tier} size={30} />
                  <b className="num">{fr(r.lp)} LP</b>
                </span>
                <small className="pp-wl num">
                  {tierText(r.tier, r.division)} · {r.wins} V – {r.losses} D ({games ? pct(r.wins / games, 0) : "—"})
                </small>
              </>
            ) : (
              <span className="pp-lp muted">
                <small>{pending ? "Lecture des comptes…" : "Aucun compte classé"}</small>
              </span>
            )}
            <b className="pp-name">{p.name}</b>
            <small className="pp-sub">
              {role && <PositionIcon position={role} size={14} />} {team.name}
              {own.length > 1 && ` · ${own.length} comptes`}
            </small>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Parties des deux dernieres semaines ----------

const WINDOW_MS = 14 * 86_400_000;
/** Plafond de parties lues par fiche (quota Riot : une requete par partie jamais vue). */
const MAX_GAMES = 40;
/** Pages de 10 : la premiere est deja en cache si le compte a ete analyse dans le classement. */
const PAGE = 10;
/** Limite Riot atteinte : pause puis nouvel essai de la meme page, 4 fois au plus. */
const RETRY_MS = 30_000;
const RETRIES = 4;

interface Recent {
  games: MatchSummary[];
  /** Derniere partie de la file vue par compte (PUUID -> ms). */
  lastPlayed: Record<string, number>;
  done: boolean;
  capped: boolean;
  failed: boolean;
  /** En pause apres une limite Riot, avant un nouvel essai. */
  waiting: boolean;
}

const EMPTY: Recent = { games: [], lastPlayed: {}, done: false, capped: false, failed: false, waiting: false };
/** Fiches deja lues pendant la session. */
const recentCache = new Map<string, Recent>();

function useRecentGames(targets: { puuid: string; platform: string }[] | null, queueId: number, attempt: number): Recent {
  const key = targets ? `${queueId}:${targets.map((t) => t.puuid).join(",")}` : null;
  const [state, setState] = useState<Recent>(() => (key && recentCache.get(key)) || EMPTY);

  useEffect(() => {
    if (!key || !targets) return;
    const hit = recentCache.get(key);
    if (hit) return setState(hit);
    let alive = true;
    (async () => {
      const cutoff = Date.now() - WINDOW_MS;
      const games: MatchSummary[] = [];
      const lastPlayed: Record<string, number> = {};
      let capped = false;
      let failed = false;
      const publish = (done: boolean, waiting = false) => alive && setState({ games: [...games], lastPlayed: { ...lastPlayed }, done, capped, failed, waiting });
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      setState(EMPTY);
      // Comptes lus du mieux classe au moins bien classe, page apres page, jusqu'a la
      // premiere partie de plus de 14 jours.
      outer: for (const t of targets) {
        let start = 0;
        for (;;) {
          if (games.length >= MAX_GAMES) {
            capped = true;
            break outer;
          }
          // Page reduite a l'approche du plafond : `start` avance du nombre reellement
          // demande, sinon les parties intermediaires seraient sautees.
          const count = Math.min(PAGE, MAX_GAMES - games.length);
          let page: MatchPageDto | null = null;
          // Nombre d'essais borne, qu'il s'agisse d'un echec ou d'une reponse vide.
          for (let tries = 0; tries <= RETRIES && !page; tries++) {
            if (tries > 0) {
              publish(false, true);
              await sleep(RETRY_MS);
              if (!alive) return;
            }
            try {
              page = (await platform.playerMatches({ platform: t.platform, puuid: t.puuid, start, count, queue: queueId })) ?? null;
            } catch {
              if (!alive) return;
            }
          }
          if (!alive) return;
          if (!page) {
            failed = true;
            break outer;
          }
          start += count;
          let old = false;
          for (const m of page.matches) {
            const s = toSummary(m, t.puuid);
            if (!s) continue;
            lastPlayed[t.puuid] = Math.max(lastPlayed[t.puuid] ?? 0, s.startedAt);
            if (s.startedAt < cutoff) old = true;
            else games.push(s);
          }
          publish(false);
          if (old || !page.hasMore || !page.matches.length) break;
        }
      }
      const final: Recent = { games, lastPlayed, done: true, capped, failed, waiting: false };
      if (!failed) recentCache.set(key, final);
      if (alive) setState(final);
    })();
    return () => {
      alive = false;
    };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  return key ? state : EMPTY;
}

interface ChampLine {
  champion: string;
  games: number;
  wins: number;
  k: number;
  d: number;
  a: number;
}

function byChampion(games: MatchSummary[]): ChampLine[] {
  const m = new Map<string, ChampLine>();
  for (const g of games) {
    const c = m.get(g.champion) ?? { champion: g.champion, games: 0, wins: 0, k: 0, d: 0, a: 0 };
    c.games++;
    if (g.win) c.wins++;
    c.k += g.kills;
    c.d += g.deaths;
    c.a += g.assists;
    m.set(g.champion, c);
  }
  return [...m.values()].sort((x, y) => y.games - x.games || y.wins - x.wins);
}

/** Duree de jeu lisible. Les minutes sont arrondies avant d'en extraire les heures : un
 *  arrondi a 60 minutes donne bien l'heure suivante, jamais « 1 h 60 ». */
function playTime(sec: number): string {
  const mins = Math.round(sec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 10) return `${h} h`;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

// ---------- Fiche d'un joueur ----------

export function ProPlayerView({
  team,
  player,
  accounts,
  queueId,
  queueLabel,
  onBack,
}: {
  team: ProTeamDto;
  player: ProPlayerDto;
  accounts: TeamAccount[];
  queueId: number;
  queueLabel: string;
  onBack: () => void;
}) {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const [attempt, setAttempt] = useState(0);
  const own = sortAccounts(accounts);
  const best = own.find((a) => a.rank) ?? own.find(profileOf) ?? own[0];
  const role = proRole(player.role);

  // Les parties ne sont lues qu'une fois tous les comptes du joueur reconnus par Riot.
  const ready = own.every((a) => a.state !== undefined);
  const targets = ready ? own.flatMap((a) => (profileOf(a) ? [{ puuid: profileOf(a)!.puuid, platform: a.account.platform }] : [])) : null;
  const recent = useRecentGames(targets, queueId, attempt);
  const games = recent.games.filter((g) => !g.remake);
  const wins = games.filter((g) => g.win).length;
  const champs = byChampion(games);
  const seconds = games.reduce((n, g) => n + g.durationSec, 0);

  return (
    <section className="lb-panel pp-view">
      <div className="lb-filters">
        <button className="btn btn-sm" onClick={onBack}>
          <ChevronLeft /> {team.name}
        </button>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => void platform.openExternal(player.pageUrl)}>
          <ExternalLink /> Fiche Leaguepedia
        </button>
      </div>

      <div className="pp-hero" aria-hidden="true">
        <span>{teamMark(team.name)}</span>
      </div>
      <div className="pp-ident">
        <AccountIcon a={best} size={104} />
        <h2>{player.name}</h2>
        <p className="pp-meta">
          <span>
            <span className="pp-mark sm">{teamMark(team.name)}</span> {team.name} · {team.league}
          </span>
          <span>
            {role && <PositionIcon position={role} size={15} />} {role ? ROLE_LABEL[role] : player.role}
          </span>
          {player.residency && <span>Résidence : {player.residency}</span>}
        </p>
      </div>

      <h3 className="pp-sep">
        <span>Comptes · {queueLabel}</span>
      </h3>
      <div className="pp-accounts">
        {own.map((a) => {
          const prof = profileOf(a);
          const [gameName, tagLine] = prof ? [prof.gameName, prof.tagLine] : splitRiotId(a.account.riotId);
          const r = a.rank;
          const n = r ? r.wins + r.losses : 0;
          const last = prof ? recent.lastPlayed[prof.puuid] : undefined;
          return (
            <button
              key={a.key}
              className="pp-acc"
              disabled={!prof}
              onClick={() => navigate("profile", { riotId: `${gameName}#${tagLine}`, platform: a.account.platform })}
            >
              <AccountIcon a={a} size={44} />
              <span className="pp-acc-id">
                <b>
                  {gameName} <small>#{tagLine}</small>
                </b>
                <small>
                  {a.state === undefined
                    ? "Lecture du compte…"
                    : a.state === "notfound"
                      ? "Riot ID introuvable chez Riot (changé ou supprimé)"
                      : a.state === "error"
                        ? "Indisponible pour l'instant (limite Riot ou réseau)"
                        : last
                          ? `Dernière partie ${queueLabel} ${timeAgo(last)}`
                          : recent.done && !recent.failed
                            ? `Aucune partie ${queueLabel} sur 14 jours`
                            : " "}
                </small>
              </span>
              <span className="pp-acc-rank">
                {r ? (
                  <>
                    <span className="pp-lpline" style={{ color: TIER_COLOR[r.tier] }}>
                      <RankCrest tier={r.tier} size={24} />
                      <b className="num">
                        {tierText(r.tier, r.division)} · {fr(r.lp)} LP
                      </b>
                    </span>
                    <small className="num">
                      {r.wins} V – {r.losses} D ({n ? pct(r.wins / n, 0) : "—"})
                    </small>
                  </>
                ) : (
                  prof && <small className="muted">Non classé en {queueLabel}</small>
                )}
              </span>
              <RegionTag plat={a.account.platform} />
            </button>
          );
        })}
      </div>

      <h3 className="pp-sep">
        <span>2 dernières semaines · {queueLabel}</span>
      </h3>
      <div className="pp-recent">
        <div className="pp-strip">
          <span>
            <small>Parties</small>
            <b className="num">{games.length}</b>
          </span>
          <span>
            <small>Victoires</small>
            <b className="num">{wins}</b>
          </span>
          <span>
            <small>Défaites</small>
            <b className="num">{games.length - wins}</b>
          </span>
          <span>
            <small>Temps de jeu</small>
            <b className="num">{games.length ? playTime(seconds) : "—"}</b>
          </span>
        </div>
        <div className="pp-champs" role="table" aria-label="Champions joués">
          <div className="pp-crow head" role="row">
            <span role="columnheader">Champion</span>
            <span role="columnheader">Parties</span>
            <span role="columnheader">Victoires</span>
            <span role="columnheader">KDA</span>
          </div>
          {champs.map((c) => {
            const wr = c.wins / c.games;
            return (
              <div key={c.champion} className="pp-crow" role="row">
                <span className="pp-champ" role="cell">
                  <ChampIcon version={version} champion={c.champion} size={34} rounded={6} />
                  {championName(c.champion)}
                </span>
                <span className="num" role="cell">
                  {c.games}
                </span>
                <span className="num" role="cell">
                  <b className={wr >= 0.6 ? "hot" : wr < 0.5 ? "cold" : ""}>{pct(wr, 0)}</b>{" "}
                  <small className="muted">
                    {c.wins} V – {c.games - c.wins} D
                  </small>
                </span>
                <b className="num" role="cell">
                  {kdaText((c.k + c.a) / Math.max(1, c.d))}
                </b>
              </div>
            );
          })}
          {!champs.length && (
            <div className="pp-crow empty" role="row">
              <span role="cell">
                {!ready
                  ? "Lecture des comptes…"
                  : !recent.done
                    ? "Lecture des parties classées…"
                    : recent.failed
                      ? "Parties indisponibles pour l'instant (limite Riot ou réseau)."
                      : `Aucune partie ${queueLabel} sur les 14 derniers jours.`}
              </span>
            </div>
          )}
        </div>
        {(recent.failed || (!recent.done && ready)) && (
          <div className="pp-note">
            {recent.done ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCw /> Réessayer
              </button>
            ) : (
              <span className="muted num">
                {recent.waiting
                  ? `Limite de requêtes Riot atteinte : nouvel essai dans ${RETRY_MS / 1000} s (${games.length} parties retenues)…`
                  : `Lecture en cours : ${games.length} parties retenues…`}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="lb-foot">
        <span>
          Comptes et affiliation : déclarés sur Leaguepedia (CC BY-SA 3.0). Rang, LP et parties : Riot (officiel). Parties {queueLabel} des 14 derniers jours sur les
          comptes reconnus par Riot, {MAX_GAMES} au maximum (comptes lus du mieux classé au moins bien classé)
          {recent.capped && " : plafond atteint, les parties plus anciennes ne sont pas comptées"}. Parties annulées exclues.
        </span>
      </div>
    </section>
  );
}
