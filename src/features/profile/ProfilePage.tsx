import { Link2, RotateCw, Search, Star, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { championName, profileIcon } from "../../data/assets";
import { useClient } from "../../app/ClientContext";
import { findParticipant, mergeLocalMatches, toSummary } from "../../domain/fromMatch";
import { nexScore } from "../../domain/nexScore";
import { groupByDay } from "../../domain/sessions";
import type { MatchSummary } from "../../domain/types";
import { attributeLp } from "../../domain/lp";
import { frequentTeammates } from "../../domain/teammates";
import { championAggregates, isCountable, kdaOf, roleDistribution, winRate } from "../../domain/metrics";
import { parseRiotId, platformLabel } from "../../domain/riotId";
import { errorMessage, platform } from "../../platform";
import type { MatchDto, PlayerProfileDto, RankDto, RankSnapshotDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { pct, ROLE_LABEL, TIER_LABEL, timeAgo } from "../../ui/format";
import { ChampIcon, EmptyState, PositionIcon, RankCrest, RemoteImg, Segmented } from "../../ui/primitives";
import { LpCard } from "./LpCard";
import { MatchHistoryRow } from "./MatchHistory";
import { TeammatesCard } from "../dashboard/TeammatesCard";

/** « 2400 » (ARAM Mayhem) : parties lues dans le client League, Riot ne les fournit pas. */
type QueueFilter = "all" | "420" | "440" | "450" | "400" | "2400";
const QUEUE_FILTERS: QueueFilter[] = ["420", "440", "400", "450", "2400"];
const QUEUE_TAB: Record<QueueFilter, string> = {
  all: "Toutes",
  "420": "Solo/Duo",
  "440": "Flex",
  "400": "Normale",
  "450": "ARAM",
  "2400": "ARAM Mayhem",
};
const PAGE = 10;

export function ProfilePage({ onSearch }: { onSearch: () => void }) {
  const { location } = useNav();
  const { settings, favorites, recent } = useAppState();
  let riotId = location.params?.riotId;
  let plat = location.params?.platform;
  if (!riotId && settings.linkedRiotId) {
    riotId = settings.linkedRiotId;
    plat = settings.linkedPlatform;
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <User aria-hidden="true" /> Profil & historique
        </h1>
        <div className="spacer" />
        <button className="btn" onClick={onSearch}>
          <Search /> Rechercher un joueur
        </button>
      </div>
      {riotId && plat ? (
        <PlayerView key={`${plat}:${riotId}`} riotId={riotId} plat={plat} />
      ) : (
        <>
          <div className="card">
            <EmptyState
              icon={<Search />}
              title="Recherche un joueur par Riot ID"
              action={
                <button className="btn btn-primary" onClick={onSearch}>
                  Ouvrir la recherche (Ctrl+K)
                </button>
              }
            >
              Saisis Pseudo#TAG et choisis la région. Sur ton propre profil, « C'est mon compte » alimente le dashboard.
            </EmptyState>
          </div>
          <SavedLists favorites={favorites} recent={recent} />
        </>
      )}
    </div>
  );
}

function SavedLists({ favorites, recent }: { favorites: ReturnType<typeof useAppState>["favorites"]; recent: ReturnType<typeof useAppState>["recent"] }) {
  const { navigate } = useNav();
  if (!favorites.length && !recent.length) return null;
  return (
    <div className="saved-lists">
      {[
        { title: "Favoris", list: favorites },
        { title: "Recherches récentes", list: recent },
      ].map(({ title, list }) => (
        <div className="card card-pad" key={title}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            {title}
          </div>
          {list.length === 0 && <div className="muted">Aucun.</div>}
          {list.slice(0, 8).map((p) => (
            <button key={p.id} className="palette-item" onClick={() => navigate("profile", { riotId: `${p.gameName}#${p.tagLine}`, platform: p.platform })}>
              <span>
                {p.gameName}#{p.tagLine}
              </span>
              <span className="meta">
                {platformLabel(p.platform)} · {timeAgo(p.at * 1000)}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function PlayerView({ riotId, plat }: { riotId: string; plat: string }) {
  const parsed = parseRiotId(riotId);
  const profile = useAsync<PlayerProfileDto>(
    parsed.ok ? `profile:${plat}:${riotId.toLowerCase()}` : null,
    () => platform.playerProfile(riotId, plat),
    60_000,
  );
  if (!parsed.ok) return <ErrorPanel error={{ code: "invalid_input", message: parsed.error }} />;
  if (profile.error != null && !profile.data) return <ErrorPanel error={profile.error} onRetry={() => profile.reload()} />;
  if (!profile.data) return <div className="card card-pad muted">Chargement du profil {riotId}…</div>;
  return (
    <ProfileLoaded
      profile={profile.data}
      refreshing={profile.loading}
      refreshError={profile.error}
      onRefresh={() => profile.reload(() => platform.playerProfile(riotId, plat, true))}
    />
  );
}

function ProfileLoaded({
  profile,
  refreshing,
  refreshError,
  onRefresh,
}: {
  profile: PlayerProfileDto;
  refreshing: boolean;
  refreshError: unknown;
  onRefresh: () => void;
}) {
  const version = useDDragonVersion();
  const { favorites, toggleFavorite, settings, setSetting, notify } = useAppState();
  const riotId = `${profile.gameName}#${profile.tagLine}`;
  const isFav = favorites.some((f) => `${f.gameName}#${f.tagLine}`.toLowerCase() === riotId.toLowerCase() && f.platform === profile.platform);
  const isMine = settings.linkedRiotId.toLowerCase() === riotId.toLowerCase() && settings.linkedPlatform === profile.platform;

  const [queue, setQueue] = useState<QueueFilter>("all");
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [champ, setChamp] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Parties ARAM Mayhem : l'API de Riot ne les fournit pas (403). Elles sont lues dans le
  // client League, donc seulement pour son propre compte et client ouvert.
  const client = useClient();
  const clientUp = platform.capabilities.localClient && client.state?.status === "connected";
  const local = useAsync<MatchDto[]>(isMine && clientUp ? `local-mayhem:${profile.puuid}` : null, () => platform.localMayhemMatches(riotId, profile.puuid, 40), 60_000);
  // Releves de rang deja enregistres : lecture locale du backend, aucune requete Riot.
  const ranks = useAsync<RankSnapshotDto[]>(`ranks:${profile.platform}:${profile.puuid}`, () => platform.rankHistory(profile.platform, profile.puuid), 60_000);

  const load = useCallback(
    async (start: number, reset: boolean, token: { cancelled: boolean }) => {
      if (queue === "2400") {
        // Filtre servi par le client local uniquement : aucun appel Riot.
        setMatches([]);
        setHasMore(false);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const page = await platform.playerMatches({
          platform: profile.platform,
          puuid: profile.puuid,
          start,
          count: PAGE,
          queue: queue === "all" ? undefined : Number(queue),
          // Timelines des 5 parties les plus recentes de la 1re page : ecart d'or @15.
          timelines: start === 0 ? 5 : 0,
        });
        if (token.cancelled) return;
        setMatches((prev) => (reset ? page.matches : [...prev, ...page.matches.filter((m) => !prev.some((p) => p.id === m.id))]));
        setHasMore(page.hasMore);
      } catch (e) {
        if (!token.cancelled) setError(e);
      } finally {
        if (!token.cancelled) setLoading(false);
      }
    },
    [profile.platform, profile.puuid, queue],
  );

  useEffect(() => {
    const token = { cancelled: false };
    setMatches([]);
    setExpanded(null);
    void load(0, true, token);
    return () => {
      token.cancelled = true;
    };
  }, [load, reloadToken]);

  const loaded = useMemo(() => {
    const mayhem = local.data ?? [];
    if (queue === "2400") return mayhem;
    return queue === "all" ? mergeLocalMatches(matches, mayhem, hasMore) : matches;
  }, [queue, matches, hasMore, local.data]);
  // Compteurs par file, sur l'echantillon charge. Quand une file est selectionnee, Riot ne
  // sert que celle-la : seul son compteur est connu, les autres restent sans chiffre.
  const queueCounts = useMemo(() => {
    const out = new Map<QueueFilter, number>([["all", loaded.length]]);
    // Sur « Toutes », l'echantillon porte toutes les files : une file absente vaut zero.
    // Sur une file precise, Riot n'a servi que celle-la : les autres restent sans chiffre.
    if (queue === "all") for (const k of QUEUE_FILTERS) out.set(k, 0);
    for (const m of loaded) {
      const k = String(m.queueId) as QueueFilter;
      if (QUEUE_FILTERS.includes(k)) out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  }, [loaded, queue]);
  const champions = useMemo(() => [...new Set(loaded.map((m) => findParticipant(m, profile.puuid)?.champion).filter((c): c is string => !!c))].sort(), [loaded, profile.puuid]);
  const shown = useMemo(() => (champ === "all" ? loaded : loaded.filter((m) => findParticipant(m, profile.puuid)?.champion === champ)), [loaded, champ, profile.puuid]);
  const summaries = useMemo(
    () => shown.map((m) => toSummary(m, profile.puuid)).filter((s): s is NonNullable<typeof s> => s !== null),
    [shown, profile.puuid],
  );
  const counted = summaries.filter(isCountable);
  const champs = championAggregates(summaries).slice(0, 6);
  const roles = roleDistribution(summaries);
  // Coequipiers frequents, sur les memes parties que le reste de la colonne (filtre compris).
  const mates = useMemo(() => frequentTeammates(shown, profile.puuid), [shown, profile.puuid]);
  // ±LP par partie, a partir des releves deja enregistres (lecture locale du backend).
  const lp = useMemo(() => attributeLp(summaries, ranks.data ?? []), [summaries, ranks.data]);
  // Fin de la partie la plus recente chargee, pour « Dernière partie il y a … ».
  const lastPlayed = summaries.length ? Math.max(...summaries.map((m) => m.startedAt + m.durationSec * 1000)) : null;
  const period = counted.length
    ? `${new Date(Math.min(...counted.map((m) => m.startedAt))).toLocaleDateString("fr-FR")} – ${new Date(Math.max(...counted.map((m) => m.startedAt))).toLocaleDateString("fr-FR")}`
    : null;

  const solo = profile.ranks.find((r) => r.queue === "RANKED_SOLO_5x5");
  const flex = profile.ranks.find((r) => r.queue === "RANKED_FLEX_SR");

  return (
    <div className="profile">
      <section className="card profile-head">
        <span className="avatar" style={{ width: 72, height: 72 }}>
          <RemoteImg src={profileIcon(version, profile.profileIconId)} alt="Icône de profil" fallback="?" />
          <span className="avatar-level num">{profile.level}</span>
        </span>
        <div>
          <div className="hero-name" style={{ fontSize: 28 }}>
            {profile.gameName}
            <span className="muted" style={{ fontWeight: 600 }}>
              {" "}
              #{profile.tagLine}
            </span>
          </div>
          <div className="muted" style={{ marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className="chip">{platformLabel(profile.platform)}</span>
            <span>Niveau {profile.level}</span>
            {lastPlayed !== null && <span>Dernière partie {timeAgo(lastPlayed)}</span>}
            <span>Actualisé {timeAgo(profile.fetchedAt)}</span>
          </div>
          {refreshError != null && <div className="neg" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>Actualisation impossible : {errorMessage(refreshError)}</div>}
        </div>
        <div className="spacer" />
        <div className="profile-actions">
          <button
            className="btn"
            disabled={refreshing}
            onClick={() => {
              onRefresh();
              setReloadToken((t) => t + 1);
            }}
          >
            <RotateCw className={refreshing ? "spin" : ""} /> {refreshing ? "Actualisation…" : "Actualiser"}
          </button>
          <button className="btn" aria-pressed={isFav} onClick={() => toggleFavorite(riotId, profile.platform)}>
            <Star fill={isFav ? "currentColor" : "none"} style={isFav ? { color: "var(--gold)" } : undefined} />
            {isFav ? "Favori" : "Favori"}
          </button>
          <button
            className={`btn ${isMine ? "" : "btn-primary"}`}
            onClick={async () => {
              if (isMine) {
                await setSetting("linkedRiotId", "");
                notify("Compte délié du dashboard");
              } else {
                await setSetting("linkedRiotId", riotId);
                await setSetting("linkedPlatform", profile.platform);
                notify("Compte lié : le dashboard utilise maintenant ce profil", "success");
              }
            }}
          >
            <Link2 /> {isMine ? "Délier mon compte" : "C'est mon compte"}
          </button>
        </div>
      </section>

      <div className="profile-grid">
        <aside className="profile-side">
          <RankBlock title="Classée Solo/Duo" rank={solo} />
          <RankBlock title="Classée Flex" rank={flex} />
          <LpCard puuid={profile.puuid} plat={profile.platform} />
          <section className="card card-pad">
            <div className="card-title">Champions</div>
            <div className="muted sample-note">
              {counted.length
                ? `Sur ${counted.length} partie${counted.length > 1 ? "s" : ""} chargée${counted.length > 1 ? "s" : ""} (${period}), pas la saison complète.`
                : "Aucune partie chargée."}
            </div>
            <ul className="champ-table">
              {champs.map((c) => (
                <li key={c.champion}>
                  <ChampIcon version={version} champion={c.champion} size={28} rounded={14} />
                  <span>
                    <b>{championName(c.champion)}</b>
                    <span className="muted num">
                      {kdaOf(c.kills, c.deaths, c.assists).toFixed(1)} KDA
                    </span>
                  </span>
                  <span className="num" style={{ textAlign: "right" }}>
                    <b className={(winRate(c.wins, c.games - c.wins) ?? 0) >= 0.5 ? "win" : "loss"}>{pct(winRate(c.wins, c.games - c.wins))}</b>
                    <span className="muted">
                      {c.games} partie{c.games > 1 ? "s" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card card-pad">
            <div className="card-title">Rôles</div>
            <div className="roles" style={{ borderTop: 0, paddingTop: 8 }}>
              {roles.map((r) => (
                <div key={r.role} title={`${r.games} partie(s), victoire ${pct(r.winRate)}`}>
                  <PositionIcon position={r.role} size={18} />
                  <b className="num">{pct(r.share)}</b>
                  <div className="bar">
                    <i style={{ width: `${r.share * 100}%` }} />
                  </div>
                  <span>{ROLE_LABEL[r.role]}</span>
                </div>
              ))}
            </div>
          </section>
          <TeammatesCard mates={mates} plat={profile.platform} sample={shown.length} />
        </aside>

        <section className="history" aria-label="Historique des parties">
          <div className="history-head">
            <Segmented
              label="File"
              options={(["all", ...QUEUE_FILTERS] as QueueFilter[]).map((v) => {
                const n = queueCounts.get(v);
                return { value: v, label: n === undefined ? QUEUE_TAB[v] : `${QUEUE_TAB[v]} ${n}` };
              })}
              value={queue}
              onChange={(v) => {
                setQueue(v);
                setChamp("all");
              }}
            />
            <label className="field">
              <span className="sr-only">Champion</span>
              <select className="select" value={champ} onChange={(e) => setChamp(e.target.value)} aria-label="Filtrer par champion">
                <option value="all">Tous les champions</option>
                {champions.map((c) => (
                  <option key={c} value={c}>
                    {championName(c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <HistorySummary summaries={summaries} />

          {error != null && <ErrorPanel error={error} onRetry={() => setReloadToken((t) => t + 1)} compact />}
          {!loading && !error && !(queue === "2400" && local.loading) && shown.length === 0 && (
            <div className="card">
              {queue === "2400" ? (
                <EmptyState title="Aucune partie ARAM Mayhem">
                  {!platform.capabilities.localClient
                    ? "Riot ne fournit pas les parties ARAM Mayhem par son API. NEX les lit dans le client League : disponible dans l'application desktop, pour ton propre compte."
                    : !isMine
                      ? "Riot ne fournit pas les parties ARAM Mayhem par son API. NEX les lit dans le client League, donc seulement pour ton propre compte (lie-le avec « C'est mon compte »)."
                      : !clientUp
                        ? "Ouvre le client League : NEX y lit tes parties ARAM Mayhem (Riot ne les fournit pas par son API)."
                        : local.error != null
                          ? "Lecture de l'historique du client impossible pour l'instant. Réessaie dans un instant."
                          : "Aucune partie ARAM Mayhem parmi tes 60 dernières parties, ou ce compte n'est pas celui du client League ouvert."}
                </EmptyState>
              ) : (
                <EmptyState title="Aucune partie">Aucune partie trouvée pour ce filtre.</EmptyState>
              )}
            </div>
          )}
          {groupByDay(summaries.map((s) => ({ ...s, lpDelta: lp.get(s.id) ?? null }))).map((day) => (
            <div className="hist-day" key={day.day}>
              <div className="hist-day-head">
                <b>{day.label}</b>
                <span className="num">
                  {day.wins}V {day.losses}D
                </span>
                {day.lpDelta !== null && (
                  <span className={`num ${day.lpDelta > 0 ? "pos" : day.lpDelta < 0 ? "neg" : "muted"}`}>
                    {day.lpDelta > 0 ? "+" : ""}
                    {day.lpDelta} LP
                  </span>
                )}
              </div>
              {day.matches.map((s) => {
                const m = shown.find((x) => x.id === s.id)!;
                return (
                  <MatchHistoryRow
                    key={m.id}
                    match={m}
                    puuid={profile.puuid}
                    lpDelta={s.lpDelta}
                    expanded={expanded === m.id}
                    onToggle={() => setExpanded((e) => (e === m.id ? null : m.id))}
                  />
                );
              })}
            </div>
          ))}
          {(loading || (queue === "2400" && local.loading)) && <div className="card card-pad muted">Chargement des parties…</div>}
          {!loading && hasMore && (
            <button className="btn" style={{ justifySelf: "center" }} onClick={() => void load(matches.length, false, { cancelled: false })}>
              Charger {PAGE} parties de plus
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Bilan de l'echantillon affiche, suivi d'une bande de points : un par partie, de la plus
 * ancienne a la plus recente. Les remakes ne comptent pas dans les moyennes, et le Score NEX
 * n'existe pas en ARAM : il n'apparait que s'il a ete calculable quelque part.
 */
function HistorySummary({ summaries }: { summaries: MatchSummary[] }) {
  const counted = summaries.filter(isCountable);
  if (counted.length === 0) return null;
  const wins = counted.filter((m) => m.win).length;
  const kda = kdaOf(
    counted.reduce((a, m) => a + m.kills, 0),
    counted.reduce((a, m) => a + m.deaths, 0),
    counted.reduce((a, m) => a + m.assists, 0),
  );
  const minutes = counted.reduce((a, m) => a + m.durationSec / 60, 0);
  const csm = minutes > 0 ? counted.reduce((a, m) => a + m.cs, 0) / minutes : null;
  const scores = counted.map((m) => nexScore(m).score).filter((s): s is number => s !== null);

  return (
    <div className="hist-summary">
      <span>
        <b className="num">{counted.length}</b> parties
      </span>
      <span className="num">
        {wins}V {counted.length - wins}D <b>{pct(wins / counted.length)}</b>
      </span>
      <span className="num">
        <b>{kda.toFixed(2)}</b> KDA
      </span>
      {csm !== null && (
        <span className="num">
          <b>{csm.toFixed(1)}</b> CS/min
        </span>
      )}
      {scores.length > 0 && (
        <span className="num">
          <b>{Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}</b> de score moyen
        </span>
      )}
      <span className="spacer" />
      <span className="hist-dots" aria-hidden="true">
        {[...counted].reverse().map((m) => (
          <i key={m.id} className={m.win ? "win" : "loss"} />
        ))}
      </span>
    </div>
  );
}

function RankBlock({ title, rank }: { title: string; rank: RankDto | undefined }) {
  const wr = rank ? winRate(rank.wins, rank.losses) : null;
  return (
    <section className="card rank-card" aria-label={title}>
      <div>
        <div className="rank-queue">{title}</div>
        {rank ? (
          <>
            <div className="rank-tier">
              {TIER_LABEL[rank.tier] ?? rank.tier} {rank.division ?? ""}
            </div>
            <div className="rank-lp num">
              {rank.lp} LP
              <span>
                {rank.wins}V – {rank.losses}D ({pct(wr)})
              </span>
            </div>
          </>
        ) : (
          <div className="rank-tier muted" style={{ fontSize: 16 }}>
            Non classé
          </div>
        )}
      </div>
      {rank && <RankCrest tier={rank.tier} size={54} />}
    </section>
  );
}
