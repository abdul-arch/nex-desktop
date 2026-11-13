// Classements : paliers Challenger / Grand Maitre / Maitre d'une region (Riot league-v4),
// Top 3 mis en avant, tableau detaille, specialistes d'un champion et listes locales.
// Rang, LP, victoires et defaites sont officiels ; role, KDA et champions sont calculees sur
// les 20 dernieres parties de la file et presentees comme telles.
import { ChevronLeft, ChevronRight, ListPlus, RotateCw, Search, Trash, Trophy } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { championName, profileIcon } from "../../data/assets";
import { rankValue } from "../../domain/playerSample";
import { PLATFORMS, parseRiotId, platformLabel } from "../../domain/riotId";
import type { Role } from "../../domain/types";
import { errorMessage, platform } from "../../platform";
import type { LeaderboardDto, LeaderboardEntryDto, PlayerProfileDto, ProTeamDto, ProTeamsDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { pct, ROLE_LABEL, TIER_LABEL, timeAgo } from "../../ui/format";
import { ChampIcon, EmptyState, PositionIcon, RankCrest, RemoteImg } from "../../ui/primitives";
import { ChampionPicker, useChampionList } from "../stats/statsShared";
import { SAMPLE_SIZE, retryFailedExtras, usePlayerExtras, type PlayerExtra } from "./enrich";
import { PlayerCards, ProPlayerView, type AccountState, type TeamAccount } from "./ProPlayer";
import { RegionTag, fr, kdaText, teamMark, tierText } from "./shared";

type Tab = "solo" | "flex" | "specialists" | "lists";
type Tier = "CHALLENGER" | "GRANDMASTER" | "MASTER";
type RoleFilter = "" | Role;

const ROLES: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const QUEUE = { solo: { api: "RANKED_SOLO_5x5", id: 420 }, flex: { api: "RANKED_FLEX_SR", id: 440 } } as const;
/** Minimum de parties sur un champion, dans l'echantillon, pour figurer parmi ses specialistes. */
const SPECIALIST_MIN_GAMES = 5;

/** Filtres et defilement conserves pendant la session (retour depuis un profil). */
const saved = {
  tab: "solo" as Tab,
  plat: "",
  tier: "CHALLENGER" as Tier,
  page: 1,
  role: "" as RoleFilter,
  q: "",
  champion: null as number | null,
  scroll: 0,
  team: null as string | null,
  /** Joueur pro ouvert dans le classement d'une equipe. */
  player: null as string | null,
  proOnly: false,
};

/** Affiliation d'un compte, d'apres sa declaration sur Leaguepedia. */
interface ProTag {
  team: string;
  player: string;
  role: string;
}

/** Comptes declares, indexes par region et Riot ID exact (insensible a la casse). */
function buildProIndex(d: ProTeamsDto | null | undefined): Map<string, ProTag> {
  const m = new Map<string, ProTag>();
  for (const t of d?.teams ?? []) {
    for (const p of t.players) {
      for (const a of p.accounts) m.set(`${a.platform}:${a.riotId.toLowerCase()}`, { team: t.name, player: p.name, role: p.role });
    }
  }
  return m;
}

const proKey = (plat: string, gameName: string, tagLine: string) => `${plat}:${`${gameName}#${tagLine}`.toLowerCase()}`;

export function LeaderboardsPage() {
  const { settings } = useAppState();
  const [tab, setTab] = useState<Tab>(saved.tab);
  const [plat, setPlat] = useState(saved.plat || (settings.linkedRiotId ? settings.linkedPlatform : settings.defaultPlatform));
  useEffect(() => {
    saved.tab = tab;
    saved.plat = plat;
  }, [tab, plat]);

  // Position de defilement rendue au retour d'un profil.
  useLayoutEffect(() => {
    const main = document.querySelector("main.content");
    if (!main) return;
    // Position rendue avant l'affichage (l'application ne remet pas cette page en haut), et
    // relevee au moment de quitter la page : aucun evenement de defilement n'est necessaire.
    main.scrollTop = saved.scroll;
    return () => {
      saved.scroll = main.scrollTop;
    };
  }, []);

  // Equipes pro (Leaguepedia, cache 24 h cote backend).
  const pros = useAsync<ProTeamsDto>("pro-teams", () => platform.proTeams(), 3_600_000);
  const [team, setTeam] = useState<string | null>(saved.team);
  useEffect(() => {
    saved.team = team;
  }, [team]);
  const proIndex = useMemo(() => buildProIndex(pros.data), [pros.data]);
  const openTeam = pros.data?.teams.find((t) => t.name === team) ?? null;
  const ranked = tab === "solo" || tab === "flex";

  return (
    <div className="page lb-page">
      <div className="page-head lb-head">
        <h1 className="page-title">
          <Trophy aria-hidden="true" /> Classements
        </h1>
        <p className="page-sub">Explore les classements et trouve les meilleurs joueurs par région.</p>
        <div className="spacer" />
        <div className="lb-tabs" role="tablist" aria-label="Classement">
          {(
            [
              ["solo", "Solo/Duo"],
              ["flex", "Flex"],
              ["specialists", "Spécialistes"],
              ["lists", "Mes listes"],
            ] as [Tab, string][]
          ).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? "active" : ""} onClick={() => setTab(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="lb-banners">
        {pros.data ? (
          <div className="lb-teams">
            {pros.data.teams.map((t) => {
              const accounts = t.players.reduce((n, p) => n + p.accounts.length, 0);
              return accounts > 0 ? (
                <button
                  key={t.name}
                  className={`lb-banner lb-team ${team === t.name ? "active" : ""}`}
                  onClick={() => {
                    saved.player = null;
                    setTeam(team === t.name ? null : t.name);
                    if (!ranked) setTab("solo");
                  }}
                  aria-pressed={team === t.name}
                >
                  <span className="lb-team-mark" aria-hidden="true">
                    {teamMark(t.name)}
                  </span>
                  <b>{t.name} ›</b>
                  <span>
                    {t.league} · {t.players.length} joueurs · {accounts} comptes
                  </span>
                </button>
              ) : (
                <div key={t.name} className="lb-banner lb-team off">
                  <b>{t.name}</b>
                  <span>Indisponible : aucun compte déclaré exploitable</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="lb-banner off">
            <b>Équipes et joueurs professionnels</b>
            <span>{pros.error != null ? `Indisponible : ${errorMessage(pros.error)}` : "Chargement des équipes (Leaguepedia)…"}</span>
          </div>
        )}
        <button className="lb-banner" onClick={() => setTab("lists")}>
          <ListPlus aria-hidden="true" />
          <b>Crée ton classement ›</b>
          <span>Liste locale de comptes à suivre et à comparer</span>
        </button>
      </div>

      {tab === "lists" ? (
        <MyLists defaultPlat={plat} />
      ) : openTeam && ranked ? (
        <TeamBoard key={`${openTeam.name}:${tab}`} team={openTeam} tab={tab} source={pros.data!} onClose={() => setTeam(null)} />
      ) : (
        <Board key={tab} tab={tab} plat={plat} onPlat={setPlat} pros={proIndex} proSource={pros.data ?? null} />
      )}
    </div>
  );
}

// ---------- Classement d'une region ----------

function Board({
  tab,
  plat,
  onPlat,
  pros,
  proSource,
}: {
  tab: "solo" | "flex" | "specialists";
  plat: string;
  onPlat: (p: string) => void;
  pros: Map<string, ProTag>;
  proSource: ProTeamsDto | null;
}) {
  const queue = tab === "flex" ? QUEUE.flex : QUEUE.solo;
  const [tier, setTier] = useState<Tier>(saved.tier);
  const [page, setPage] = useState(saved.page);
  const [role, setRole] = useState<RoleFilter>(saved.role);
  const [q, setQ] = useState(saved.q);
  const [champion, setChampion] = useState<number | null>(saved.champion);
  const [proOnly, setProOnly] = useState(saved.proOnly);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    Object.assign(saved, { tier, page, role, q, champion, proOnly });
  }, [tier, page, role, q, champion, proOnly]);
  // Affiliation : Riot ID exact (renvoye par Riot pour ce compte) declare sur Leaguepedia.
  const proOf = (e: LeaderboardEntryDto) => (e.gameName && e.tagLine ? pros.get(proKey(plat, e.gameName, e.tagLine)) : undefined);

  const board = useAsync<LeaderboardDto>(`board:${plat}:${queue.api}:${tier}:${page}`, () => platform.leaderboard(plat, queue.api, tier, page), 300_000);
  // Une reponse d'une autre region ou d'une autre file n'est jamais affichee (cle de cache).
  const d = board.data;
  const entries = d?.entries ?? [];
  const extras = usePlayerExtras(
    plat,
    queue.id,
    entries.map((e) => ({ puuid: e.puuid, riotId: e.gameName && e.tagLine ? `${e.gameName}#${e.tagLine}` : null })),
    attempt,
  );
  const champions = useChampionList();
  const championKey = champion ? (champions.find((c) => c.id === champion)?.key ?? null) : null;

  const analysed = entries.filter((e) => extras.get(e.puuid)?.sample).length;
  const roleShare = useMemo(() => {
    const counts = new Map<Role, number>();
    let n = 0;
    for (const e of entries) {
      const r = extras.get(e.puuid)?.sample?.role;
      if (r) {
        counts.set(r, (counts.get(r) ?? 0) + 1);
        n++;
      }
    }
    return { counts, n };
  }, [entries, extras]);

  const needle = q.trim().toLowerCase();
  const visible = entries.filter((e) => {
    if (needle && !`${e.gameName}#${e.tagLine}`.toLowerCase().includes(needle)) return false;
    if (proOnly && !proOf(e)) return false;
    const s = extras.get(e.puuid)?.sample;
    if (role && s?.role !== role) return false;
    if (tab === "specialists") {
      if (!championKey) return false;
      return (s?.champions.find((c) => c.champion === championKey)?.games ?? 0) >= SPECIALIST_MIN_GAMES;
    }
    return true;
  });
  const top = tab === "specialists" ? [] : visible.slice(0, 3);
  const rest = tab === "specialists" ? visible : visible.slice(3);
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <section className="lb-panel">
      <div className="lb-filters">
        <div className="lb-roles" role="radiogroup" aria-label="Rôle principal">
          <button role="radio" aria-checked={role === ""} className={role === "" ? "active" : ""} onClick={() => setRole("")} aria-label="Tous les rôles">
            <b>Tous</b>
          </button>
          {ROLES.map((r) => (
            <button key={r} role="radio" aria-checked={role === r} className={role === r ? "active" : ""} onClick={() => setRole(r)} aria-label={ROLE_LABEL[r]} title={ROLE_LABEL[r]}>
              <PositionIcon position={r} size={18} />
              <small className="num">{roleShare.n ? pct((roleShare.counts.get(r) ?? 0) / roleShare.n, 0) : "—"}</small>
            </button>
          ))}
        </div>
        <label className="search-box lb-search">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un Riot ID dans la page" aria-label="Rechercher un Riot ID dans la page" />
        </label>
        {tab === "specialists" && (
          <div style={{ minWidth: 200 }}>
            <ChampionPicker value={champion} onChange={setChampion} placeholder="Choisir un champion" />
          </div>
        )}
        <span className="spacer" />
        <label className="lb-switch" title="Comptes déclarés par des joueurs professionnels sur Leaguepedia">
          <span className={proOnly ? "" : "on"}>Tous</span>
          <input type="checkbox" role="switch" checked={proOnly} onChange={(e) => setProOnly(e.target.checked)} aria-label="Professionnels seulement" />
          <span className={proOnly ? "on" : ""}>Pro</span>
        </label>
        <select className="select" value={tier} onChange={(e) => reset(setTier)(e.target.value as Tier)} aria-label="Palier">
          {(["CHALLENGER", "GRANDMASTER", "MASTER"] as Tier[]).map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={plat}
          onChange={(e) => {
            onPlat(e.target.value);
            setPage(1);
          }}
          aria-label="Région"
        >
          {PLATFORMS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {tab === "specialists" && (
        <p className="lb-note">
          Critères : au moins {SPECIALIST_MIN_GAMES} parties sur le champion parmi les {SAMPLE_SIZE} dernières parties Solo/Duo du joueur, dans la page de classement affichée. Un bon
          rang ne fait pas d'un joueur un spécialiste : seule la part de parties sur le champion compte ici.
        </p>
      )}

      {board.error != null && !d ? (
        <ErrorPanel error={board.error} onRetry={() => board.reload()} />
      ) : !d ? (
        <div className="lb-top">
          {[0, 1, 2].map((i) => (
            <div key={i} className="lb-card skeleton" aria-hidden="true" />
          ))}
        </div>
      ) : (
        <>
          {top.length > 0 && (
            <div className="lb-top">
              {top.map((e, i) => (
                <TopCard key={e.puuid} e={e} place={i + 1} plat={d.platform} tier={d.tier} extra={extras.get(e.puuid)} pro={proOf(e)} />
              ))}
            </div>
          )}

          {rest.length > 0 && (
            <div className="lb-table" role="table" aria-label="Classement détaillé">
              <div className="lb-row lb-headrow" role="row">
                <span role="columnheader">#</span>
                <span role="columnheader" />
                <span role="columnheader">Joueur</span>
                <span role="columnheader" className="center">
                  Rôle
                </span>
                <span role="columnheader">Rang</span>
                <span role="columnheader">Winrate</span>
                <span role="columnheader">KDA</span>
                <span role="columnheader">Champions les plus joués</span>
              </div>
              {rest.map((e) => (
                <Row key={e.puuid} e={e} plat={d.platform} tier={d.tier} extra={extras.get(e.puuid)} highlight={tab === "specialists" ? championKey : null} pro={proOf(e)} />
              ))}
            </div>
          )}

          {visible.length === 0 && (
            <div className="card">
              <EmptyState title={tab === "specialists" && !championKey ? "Choisis un champion" : "Aucun joueur"}>
                {tab === "specialists" && !championKey
                  ? "Les spécialistes sont cherchés parmi les joueurs de la page de classement affichée."
                  : proOnly
                    ? "Aucun compte de cette page n'est déclaré par un joueur professionnel des équipes suivies (Leaguepedia). Essaie une autre page ou une autre région, ou ouvre une équipe dans le bandeau."
                    : analysed < entries.length && (role || tab === "specialists")
                      ? `Analyse en cours : ${analysed} joueurs sur ${entries.length}. Ce filtre dépend des dernières parties de chaque joueur.`
                      : "Aucun joueur de cette page ne correspond aux filtres."}
              </EmptyState>
            </div>
          )}

          <div className="lb-foot">
            <span>
              {TIER_LABEL[d.tier]} {platformLabel(d.platform)} · {fr(d.total)} joueurs · relevé {timeAgo(d.fetchedAt)}. Rang, LP, victoires et défaites : Riot (officiel, saison en
              cours). Rôle, KDA et champions : calculés sur les {SAMPLE_SIZE} dernières parties {tab === "flex" ? "Flex" : "Solo/Duo"}, pas sur la saison ({analysed}/
              {entries.length} joueurs analysés).
              {proSource && (
                <>
                  {" "}
                  Affiliations : comptes déclarés sur <a href={proSource.sourceUrl}>{proSource.source}</a> ({proSource.license}), collecte {timeAgo(proSource.fetchedAt)}.
                </>
              )}
            </span>
            <span className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                // Retente aussi les joueurs dont l'analyse a echoue (quota Riot, reseau).
                retryFailedExtras();
                setAttempt((n) => n + 1);
                board.reload();
              }}
              disabled={board.loading}
            >
              <RotateCw /> Actualiser
            </button>
            <button className="icon-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Page précédente">
              <ChevronLeft />
            </button>
            <span className="num">
              {page} / {pages}
            </span>
            <button className="icon-btn" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Page suivante">
              <ChevronRight />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function usePlayerLink(e: LeaderboardEntryDto, plat: string) {
  const { navigate } = useNav();
  const named = !!(e.gameName && e.tagLine);
  return { named, open: () => named && navigate("profile", { riotId: `${e.gameName}#${e.tagLine}`, platform: plat }) };
}

/** Icone d'invocateur : fournie avec le classement, sinon par l'analyse du joueur. */
function Avatar({ e, extra, size }: { e: LeaderboardEntryDto; extra: PlayerExtra | undefined; size: number }) {
  const version = useDDragonVersion();
  const icon = e.profileIconId ?? extra?.profileIconId ?? null;
  return (
    <span className="lb-avatar" style={{ width: size, height: size }}>
      {icon != null && <RemoteImg src={profileIcon(version, icon)} alt="" fallback="" />}
    </span>
  );
}

function RoleCell({ extra }: { extra: PlayerExtra | undefined }) {
  const s = extra?.sample;
  if (!extra) return <span className="lb-wait">…</span>;
  if (!s?.role) return <span className="muted lb-na" title={`Moins de 5 parties avec un poste connu sur les ${SAMPLE_SIZE} dernières`}>Indisponible</span>;
  return (
    <span className="lb-role" title={`${ROLE_LABEL[s.role]} : ${pct(s.roleShare, 0)} des ${s.games} parties analysées`}>
      <PositionIcon position={s.role} size={18} />
      <small className="num">{pct(s.roleShare, 0)}</small>
    </span>
  );
}

function Champs({ extra, size, highlight }: { extra: PlayerExtra | undefined; size: number; highlight?: string | null }) {
  const version = useDDragonVersion();
  const list = extra?.sample?.champions ?? [];
  if (!extra) {
    return (
      <span className="lb-champs">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} style={{ width: size, height: size }} />
        ))}
      </span>
    );
  }
  if (!list.length) return <span className="muted lb-na">Indisponible</span>;
  return (
    <span className="lb-champs">
      {list.map((c) => (
        <span key={c.champion} className={highlight === c.champion ? "hl" : ""} title={`${championName(c.champion)} : ${c.games} parties sur ${extra.sample!.games}`}>
          <ChampIcon version={version} champion={c.champion} size={size} rounded={6} />
        </span>
      ))}
    </span>
  );
}

/**
 * Identite affichee : pour un compte declare par un pro, la personne (pseudo pro) en titre et
 * le compte (Riot ID) avec l'equipe dessous ; sinon le Riot ID.
 */
function Identity({ e, pro }: { e: LeaderboardEntryDto; pro?: ProTag }) {
  const named = !!(e.gameName && e.tagLine);
  if (!named) {
    return (
      <span className="lb-name">
        <b>Riot ID indisponible</b>
        <small>nouvel essai à la prochaine actualisation</small>
      </span>
    );
  }
  if (pro) {
    return (
      <span className="lb-name pro" title={`${pro.player} (${pro.team}, ${pro.role}) : compte ${e.gameName}#${e.tagLine} déclaré sur Leaguepedia`}>
        <b>{pro.player}</b>
        <small>
          {e.gameName}#{e.tagLine} · <span className="lb-team-tag">{pro.team}</span>
        </small>
      </span>
    );
  }
  return (
    <span className="lb-name">
      <b>{e.gameName}</b>
      <small>#{e.tagLine}</small>
    </span>
  );
}

function TopCard({
  e,
  place,
  plat,
  tier,
  extra,
  pro,
  tierLabel,
}: {
  e: LeaderboardEntryDto;
  place: number;
  plat: string;
  tier: string;
  extra: PlayerExtra | undefined;
  pro?: ProTag;
  /** Palier et division affiches au-dessus des LP (comptes de paliers differents). */
  tierLabel?: string;
}) {
  const { named, open } = usePlayerLink(e, plat);
  const games = e.wins + e.losses;
  const kda = kdaText(extra?.sample?.kda);
  return (
    <button className={`lb-card place-${place}`} onClick={open} disabled={!named} aria-label={named ? `Ouvrir le profil de ${e.gameName}#${e.tagLine}` : "Riot ID indisponible"}>
      <span className="lb-card-top">
        <b className="lb-place num">{e.rank}</b>
        <RegionTag plat={plat} />
        <Avatar e={e} extra={extra} size={42} />
        <Identity e={e} pro={pro} />
        <RoleCell extra={extra} />
      </span>
      <span className="lb-card-lp">
        <RankCrest tier={tier} size={44} />
        <span className="lb-lp">
          {tierLabel && <small>{tierLabel}</small>}
          <b className="num">{fr(e.lp)} LP</b>
        </span>
      </span>
      <span className="lb-card-wl num">
        {e.wins} V – {e.losses} D <span className="muted">({games ? pct(e.wins / games, 0) : "—"})</span>
      </span>
      <span className="lb-card-bottom">
        <span className="lb-stat">
          <b className="num">{fr(games)}</b>
          <small>parties</small>
        </span>
        <Champs extra={extra} size={30} />
        <span className="lb-stat end">
          <b className="num">{!extra ? "…" : (kda ?? "—")}</b>
          <small>KDA · {extra?.sample?.games ?? SAMPLE_SIZE} p.</small>
        </span>
      </span>
    </button>
  );
}

function Row({
  e,
  plat,
  tier,
  extra,
  highlight,
  pro,
  rankLabel,
  noRank,
}: {
  e: LeaderboardEntryDto;
  plat: string;
  tier: string;
  extra: PlayerExtra | undefined;
  highlight: string | null;
  pro?: ProTag;
  rankLabel?: string;
  /** Texte a la place du rang et des resultats (non classe, introuvable, chargement). */
  noRank?: string;
}) {
  const { named, open } = usePlayerLink(e, plat);
  const games = e.wins + e.losses;
  const wr = games ? e.wins / games : null;
  const kda = kdaText(extra?.sample?.kda);
  return (
    <button className="lb-row" role="row" onClick={open} disabled={!named}>
      <b className="num lb-pos" role="cell">
        {noRank ? "—" : e.rank}
      </b>
      <span role="cell">
        <RegionTag plat={plat} />
      </span>
      <span className="lb-player" role="cell">
        <Avatar e={e} extra={extra} size={32} />
        <Identity e={e} pro={pro} />
      </span>
      <span className="center" role="cell">
        <RoleCell extra={extra} />
      </span>
      {noRank ? (
        <span className="lb-rank muted" role="cell" style={{ gridColumn: "span 2" }}>
          {noRank}
        </span>
      ) : (
        <>
          <span className="lb-rank" role="cell">
            <RankCrest tier={tier} size={26} />
            <b className="num">{rankLabel ?? `${fr(e.lp)} LP`}</b>
          </span>
          <span className="lb-wl" role="cell">
            <span className="num">
              {e.wins} V – {e.losses} D
            </span>
            <b className={`num ${wr !== null && wr >= 0.6 ? "hot" : ""}`}>{pct(wr, 0)}</b>
          </span>
        </>
      )}
      <b className="num" role="cell" title={extra?.sample ? `Sur ${extra.sample.games} parties analysées` : undefined}>
        {noRank ? <span className="muted lb-na">—</span> : !extra ? "…" : (kda ?? <span className="muted lb-na">—</span>)}
      </b>
      <span role="cell">{!noRank && <Champs extra={extra} size={26} highlight={highlight} />}</span>
    </button>
  );
}

// ---------- Classement des comptes d'une equipe ----------

/** Profils deja lus pendant la session (changer d'onglet ne relance rien). */
const teamProfiles = new Map<string, AccountState>();

function TeamBoard({ team, tab, source, onClose }: { team: ProTeamDto; tab: "solo" | "flex"; source: ProTeamsDto; onClose: () => void }) {
  const queue = tab === "flex" ? QUEUE.flex : QUEUE.solo;
  const queueLabel = tab === "flex" ? "Flex" : "Solo/Duo";
  const [player, setPlayer] = useState<string | null>(saved.player);
  useEffect(() => {
    saved.player = player;
  }, [player]);
  const accounts = useMemo(
    () =>
      team.players.flatMap((p) =>
        p.accounts.map((a, i) => ({
          key: `${a.platform}:${a.riotId.toLowerCase()}`,
          player: p,
          account: a,
          index: i + 1,
          count: p.accounts.length,
        })),
      ),
    [team],
  );
  const [, bump] = useState(0);

  // Un compte a la fois (quota Riot) ; le backend met chaque profil en cache. Les echecs
  // passagers (quota, reseau) sont retentes jusqu'a 3 fois, 40 s apres le dernier passage.
  useEffect(() => {
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      for (let round = 0; round < 4 && alive; round++) {
        const todo = accounts.filter((a) => {
          const st = teamProfiles.get(a.key);
          return st === undefined || st === "error";
        });
        if (!todo.length) return;
        if (round > 0) await sleep(40_000);
        for (const a of todo) {
          if (!alive) return;
          let r: AccountState;
          try {
            r = await platform.playerProfile(a.account.riotId, a.account.platform);
          } catch (e) {
            r = (e as { code?: string })?.code === "not_found" ? "notfound" : "error";
          }
          teamProfiles.set(a.key, r);
          if (alive) bump((n) => n + 1);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [accounts]);

  const rows = accounts.map((a) => {
    const st = teamProfiles.get(a.key);
    const prof = st && typeof st === "object" ? st : null;
    const rank = prof ? (prof.ranks.find((r) => r.queue === queue.api) ?? null) : undefined;
    const [gameName, tagLine] = [a.account.riotId.slice(0, a.account.riotId.lastIndexOf("#")), a.account.riotId.slice(a.account.riotId.lastIndexOf("#") + 1)];
    const entry: LeaderboardEntryDto = {
      rank: 0,
      puuid: prof?.puuid ?? a.key,
      gameName: prof?.gameName ?? gameName,
      tagLine: prof?.tagLine ?? tagLine,
      lp: rank?.lp ?? 0,
      wins: rank?.wins ?? 0,
      losses: rank?.losses ?? 0,
      hotStreak: false,
      // Profil deja lu pour ce compte : son icone s'affiche tout de suite.
      profileIconId: prof?.profileIconId ?? null,
    };
    return { a, st, prof, rank, entry };
  });
  const ranked = rows.filter((r) => r.rank).sort((x, y) => rankValue(y.rank) - rankValue(x.rank));
  ranked.forEach((r, i) => (r.entry.rank = i + 1));
  const others = rows.filter((r) => !r.rank);
  const open = team.players.find((p) => p.name === player) ?? null;
  // Pendant la lecture d'une fiche, l'analyse des comptes (role, KDA) laisse le quota Riot libre.
  const extras = usePlayerExtras(
    "",
    queue.id,
    open ? [] : ranked.filter((r) => r.prof).map((r) => ({ puuid: r.prof!.puuid, riotId: `${r.entry.gameName}#${r.entry.tagLine}`, platform: r.a.account.platform })),
  );
  const loaded = rows.filter((r) => r.st).length;
  const label = (r: (typeof rows)[number]) => (r.rank ? `${tierText(r.rank.tier, r.rank.division)} · ${fr(r.rank.lp)} LP` : "");
  const tagOf = (r: (typeof rows)[number]): ProTag => ({ team: team.name, player: r.a.count > 1 ? `${r.a.player.name} · compte ${r.a.index}/${r.a.count}` : r.a.player.name, role: r.a.player.role });
  const teamAccounts: TeamAccount[] = rows.map((r) => ({ key: r.a.key, player: r.a.player, account: r.a.account, state: r.st, rank: r.rank }));

  if (open) {
    return (
      <ProPlayerView
        team={team}
        player={open}
        accounts={teamAccounts.filter((a) => a.player.name === open.name)}
        queueId={queue.id}
        queueLabel={queueLabel}
        onBack={() => setPlayer(null)}
      />
    );
  }

  return (
    <section className="lb-panel">
      <div className="lb-filters">
        <button className="btn btn-sm" onClick={onClose}>
          <ChevronLeft /> Classement de la région
        </button>
        <div style={{ display: "grid" }}>
          <b>
            {team.name} · {tab === "flex" ? "Flex" : "Solo/Duo"}
          </b>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            Classement des comptes suivis : {accounts.length} comptes déclarés par {team.players.filter((p) => p.accounts.length).length} joueurs, toutes régions
            confondues. Comparaison par palier, puis division, puis LP ; ce n'est pas un classement officiel.
          </span>
        </div>
        <span className="spacer" />
        <span className="muted num" style={{ fontSize: "var(--fs-xs)" }}>
          {loaded} / {accounts.length} comptes lus
        </span>
      </div>

      <h3 className="pp-title">Joueurs · compte le mieux classé</h3>
      <PlayerCards team={team} accounts={teamAccounts} onOpen={setPlayer} />

      <h3 className="pp-title">Tous les comptes</h3>
      <div className="lb-table" role="table" aria-label={`Comptes de ${team.name}`}>
        {ranked.map((r) => (
          <Row
            key={r.a.key}
            e={r.entry}
            plat={r.a.account.platform}
            tier={r.rank!.tier}
            extra={r.prof ? extras.get(r.prof.puuid) : undefined}
            highlight={null}
            pro={tagOf(r)}
            rankLabel={label(r)}
          />
        ))}
        {others.map((r) => (
          <Row
            key={r.a.key}
            e={r.entry}
            plat={r.a.account.platform}
            tier=""
            extra={undefined}
            highlight={null}
            pro={tagOf(r)}
            noRank={
              r.st === undefined
                ? "Chargement…"
                : r.st === "notfound"
                  ? "Riot ID introuvable chez Riot (changé ou supprimé depuis la déclaration)"
                  : r.st === "error"
                    ? "Indisponible pour l'instant (limite Riot ou réseau) : nouvel essai automatique"
                    : `Non classé en ${tab === "flex" ? "Flex" : "Solo/Duo"} (réponse Riot)`
            }
          />
        ))}
      </div>

      <div className="lb-foot">
        <span>
          Comptes et affiliations : déclarés sur{" "}
          <a href={source.sourceUrl}>
            {source.source}
          </a>{" "}
          ({source.license}), collecte {timeAgo(source.fetchedAt)}. Un compte n'est affiché comme confirmé que si Riot reconnaît ce Riot ID. Rang et LP : Riot (officiel). Rôle, KDA et
          champions : {SAMPLE_SIZE} dernières parties.
          {team.players.some((p) => p.unusableAccounts > 0) &&
            ` ${team.players.reduce((n, p) => n + p.unusableAccounts, 0)} comptes déclarés sans Riot ID complet ou sans région sont ignorés.`}
        </span>
      </div>
    </section>
  );
}

// ---------- Mes listes (locales, jamais publiees) ----------

interface ListAccount {
  riotId: string;
  platform: string;
}
const LIST_KEY = "nex.leaderboard.list.v1";

function readList(): ListAccount[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((a) => typeof a?.riotId === "string" && typeof a?.platform === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

function MyLists({ defaultPlat }: { defaultPlat: string }) {
  const [accounts, setAccounts] = useState<ListAccount[]>(readList);
  const [input, setInput] = useState("");
  const [plat, setPlat] = useState(defaultPlat);
  const [err, setErr] = useState<string | null>(null);
  const [queue, setQueue] = useState<"RANKED_SOLO_5x5" | "RANKED_FLEX_SR">("RANKED_SOLO_5x5");
  const [profiles, setProfiles] = useState<Record<string, PlayerProfileDto | "error">>({});

  useEffect(() => {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(accounts));
    } catch {
      /* stockage indisponible : la liste reste en memoire */
    }
  }, [accounts]);

  // Profils charges un par un (quota Riot) ; une liste modifiee entre-temps est ignoree.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const a of accounts) {
        const k = `${a.platform}:${a.riotId.toLowerCase()}`;
        if (profiles[k]) continue;
        const p = await platform.playerProfile(a.riotId, a.platform).catch(() => "error" as const);
        if (!alive) return;
        setProfiles((prev) => ({ ...prev, [k]: p }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    const p = parseRiotId(input);
    if (!p.ok) return setErr(p.error);
    const riotId = `${p.value.gameName}#${p.value.tagLine}`;
    if (accounts.some((a) => a.platform === plat && a.riotId.toLowerCase() === riotId.toLowerCase())) return setErr("Ce compte est déjà dans la liste.");
    if (accounts.length >= 50) return setErr("50 comptes au maximum.");
    setErr(null);
    setInput("");
    setAccounts([...accounts, { riotId, platform: plat }]);
  };

  const rows = accounts
    .map((a) => {
      const p = profiles[`${a.platform}:${a.riotId.toLowerCase()}`];
      const rank = p && p !== "error" ? (p.ranks.find((r) => r.queue === queue) ?? null) : undefined;
      return { a, p, rank };
    })
    .sort((x, y) => rankValue(y.rank) - rankValue(x.rank));
  const regions = new Set(accounts.map((a) => a.platform));

  return (
    <section className="lb-panel">
      <form
        className="lb-filters"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="search-box lb-search">
          <Search size={14} aria-hidden="true" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pseudo#TAG à suivre" aria-label="Riot ID à ajouter" aria-invalid={!!err} />
        </label>
        <select className="select" value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Région du compte">
          {PLATFORMS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" type="submit">
          Ajouter
        </button>
        {err && (
          <span className="field-error" role="alert">
            {err}
          </span>
        )}
        <span className="spacer" />
        <select className="select" value={queue} onChange={(e) => setQueue(e.target.value as typeof queue)} aria-label="File comparée">
          <option value="RANKED_SOLO_5x5">Solo/Duo</option>
          <option value="RANKED_FLEX_SR">Flex</option>
        </select>
      </form>
      <p className="lb-note">
        Classement des comptes suivis : cette liste reste sur ton PC et n'est jamais publiée. Comparaison par palier, puis division, puis LP
        {regions.size > 1 && " ; plusieurs régions sont mélangées, ce n'est pas un classement officiel"}.
      </p>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Aucun compte suivi">Ajoute un Riot ID pour comparer des comptes entre eux.</EmptyState>
        </div>
      ) : (
        <div className="lb-table" role="table" aria-label="Comptes suivis">
          {rows.map(({ a, p, rank }, i) => (
            <ListRow key={`${a.platform}:${a.riotId}`} a={a} p={p} rank={rank} pos={i + 1} onRemove={() => setAccounts(accounts.filter((x) => x !== a))} />
          ))}
        </div>
      )}
    </section>
  );
}

function ListRow({
  a,
  p,
  rank,
  pos,
  onRemove,
}: {
  a: ListAccount;
  p: PlayerProfileDto | "error" | undefined;
  rank: PlayerProfileDto["ranks"][number] | null | undefined;
  pos: number;
  onRemove: () => void;
}) {
  const { navigate } = useNav();
  const version = useDDragonVersion();
  const games = rank ? rank.wins + rank.losses : 0;
  return (
    <div className="lb-row lb-listrow" role="row">
      <b className="num lb-pos">{rank ? pos : "—"}</b>
      <span>
        <RegionTag plat={a.platform} />
      </span>
      <button className="lb-player link" onClick={() => navigate("profile", { riotId: a.riotId, platform: a.platform })}>
        <span className="lb-avatar" style={{ width: 32, height: 32 }}>
          {p && p !== "error" && <RemoteImg src={profileIcon(version, p.profileIconId)} alt="" fallback="" />}
        </span>
        <span className="lb-name">
          <b>{a.riotId.split("#")[0]}</b>
          <small>#{a.riotId.split("#")[1]}</small>
        </span>
      </button>
      <span className="lb-rank">
        {p === undefined ? (
          <span className="lb-wait">Chargement…</span>
        ) : p === "error" ? (
          <span className="muted">Indisponible</span>
        ) : rank ? (
          <>
            <RankCrest tier={rank.tier} size={26} />
            <b>
              {TIER_LABEL[rank.tier] ?? rank.tier} {rank.division ?? ""} · <span className="num">{fr(rank.lp)} LP</span>
            </b>
          </>
        ) : (
          <span className="muted">Non classé dans cette file</span>
        )}
      </span>
      <span className="lb-wl">
        {rank ? (
          <>
            <span className="num">
              {rank.wins} V – {rank.losses} D
            </span>
            <b className="num">{pct(games ? rank.wins / games : null, 0)}</b>
          </>
        ) : null}
      </span>
      <button className="icon-btn" onClick={onRemove} aria-label={`Retirer ${a.riotId} de la liste`}>
        <Trash />
      </button>
    </div>
  );
}
