import { ArrowUpRight, ChevronRight, Film, Gem, House, LayoutGrid, Link2, Sparkles, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { championLoading, championName, championSplash, profileIcon } from "../../data/assets";
import {
  DEMO_PROVENANCE,
  demoClips,
  demoCollection,
  demoLastRecording,
  demoMatches,
  demoPlayer,
} from "../../data/demo";
import { type Award, awardsByMatch } from "../../domain/badges";
import { mergeLocalMatches, toSummary } from "../../domain/fromMatch";
import { attributeLp } from "../../domain/lp";
import {
  METRICS,
  championAggregates,
  isCountable,
  kdaOf,
  roleDistribution,
  summarize,
  winRate,
  type MetricKey,
  type MetricSummary,
} from "../../domain/metrics";
import { NEX_SCORE_VERSION, nexScore } from "../../domain/nexScore";
import type { MatchSummary, Queue } from "../../domain/types";
import { platformLabel } from "../../domain/riotId";
import { platform } from "../../platform";
import type { MatchDto, MatchPageDto, PlayerProfileDto, RankSnapshotDto, Recording, SkinCatalog, SkinInventory } from "../../platform/api";
import { viewSkins } from "../../domain/skins";
import { frequentTeammates, type Teammate } from "../../domain/teammates";
import { TeammatesCard } from "./TeammatesCard";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { duration, pct, QUEUE_LABEL, ROLE_LABEL, TIER_LABEL, timeAgo } from "../../ui/format";
import {
  ChampIcon,
  DeltaChip,
  DemoTag,
  EmptyState,
  PositionIcon,
  RankCrest,
  RemoteImg,
  ScoreRing,
  Segmented,
  Sparkline,
  Tip,
} from "../../ui/primitives";

type QueueFilter = "all" | Queue;

/**
 * Taille d'une page de parties : l'API de Riot en sert 20 au maximum. Les metriques en
 * lisent une (20 parties), la carte des coequipiers deux (40 parties).
 */
const PAGE_SIZE = 20;

const QUEUE_OPTIONS: { value: QueueFilter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "solo", label: "Solo" },
  { value: "flex", label: "Flex" },
  { value: "normal", label: "Normale" },
  { value: "aram", label: "ARAM" },
];

/** Vue joueur commune au mode demo et au mode reel. */
interface DashPlayer {
  gameName: string;
  tagLine: string;
  platform: string;
  level: number;
  profileIconId: number;
  bannerChampion: string | null;
  bannerSkin: number;
  ranks: { queue: string; tier: string; division: string | null; lp: number; wins: number; losses: number }[];
  updatedAt: number;
}

export function DashboardPage() {
  const { settings, setSetting } = useAppState();
  const { navigate } = useNav();

  if (settings.demoMode) {
    const banner = demoPlayer.bannerChampion;
    return (
      <DashboardView
        demo
        player={{ ...demoPlayer, bannerChampion: banner, bannerSkin: 27 }}
        matches={demoMatches}
        provenance={DEMO_PROVENANCE.label}
        periods={["10", "20", "40"]}
      />
    );
  }
  if (!settings.linkedRiotId) {
    return (
      <div className="page">
        <DashHeader />
        <div className="card">
          <EmptyState
            icon={<Link2 />}
            title="Lie ton compte pour remplir le dashboard"
            action={
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={() => navigate("profile")}>
                  Rechercher mon profil
                </button>
                <button className="btn" onClick={() => setSetting("demoMode", true)}>
                  Voir la démo
                </button>
              </div>
            }
          >
            Ouvre ton profil (Ctrl+K, Pseudo#TAG) puis clique « C'est mon compte ». Les données viennent du backend NEX ; aucun
            chiffre n'est inventé en attendant.
          </EmptyState>
        </div>
      </div>
    );
  }
  return <LiveDashboard riotId={settings.linkedRiotId} plat={settings.linkedPlatform} />;
}

function LiveDashboard({ riotId, plat }: { riotId: string; plat: string }) {
  const profile = useAsync<PlayerProfileDto>(`profile:${plat}:${riotId.toLowerCase()}`, () => platform.playerProfile(riotId, plat), 60_000);
  const puuid = profile.data?.puuid ?? null;
  const page = useAsync<MatchPageDto>(
    puuid ? `dash-matches:${plat}:${puuid}` : null,
    () => platform.playerMatches({ platform: plat, puuid: puuid!, start: 0, count: PAGE_SIZE, timelines: 10 }),
    120_000,
  );
  // Parties ARAM Mayhem : Riot ne les fournit pas par son API, elles sont lues dans le client
  // League (meme cle de cache que la page Profil).
  const client = useClient();
  const clientUp = platform.capabilities.localClient && client.state?.status === "connected";
  const local = useAsync<MatchDto[]>(puuid && clientUp ? `local-mayhem:${puuid}` : null, () => platform.localMayhemMatches(riotId, puuid!, 40), 60_000);
  // Deuxieme page, uniquement pour la carte « Souvent en même équipe » : elle a besoin d'un
  // echantillon plus large que les metriques. Chargee apres la premiere, sans timeline
  // (l'ecart d'or @15 ne sert pas ici), et seulement s'il reste des parties chez Riot.
  const more = useAsync<MatchDto[]>(
    puuid && page.data?.hasMore ? `dash-mates:${plat}:${puuid}` : null,
    async () => (await platform.playerMatches({ platform: plat, puuid: puuid!, start: PAGE_SIZE, count: PAGE_SIZE })).matches,
    300_000,
  );
  // Releves de rang deja enregistres : ils donnent le ±LP de chaque partie. Lecture locale
  // du backend, sans requete Riot ; la liste est vide tant que rien n'a ete observe.
  const ranks = useAsync<RankSnapshotDto[]>(puuid ? `ranks:${plat}:${puuid}` : null, () => platform.rankHistory(plat, puuid!), 60_000);

  if (profile.error != null && !profile.data) {
    return (
      <div className="page">
        <DashHeader />
        <ErrorPanel error={profile.error} onRetry={() => profile.reload()} />
        <LocalSections />
      </div>
    );
  }
  if (!profile.data || (!page.data && !page.error)) {
    return (
      <div className="page">
        <DashHeader />
        <div className="card card-pad muted">Chargement de {riotId} et de ses dernières parties…</div>
      </div>
    );
  }
  if (page.error != null && !page.data) {
    return (
      <div className="page">
        <DashHeader />
        <ErrorPanel error={page.error} onRetry={() => page.reload()} />
        <LocalSections />
      </div>
    );
  }
  const p = profile.data;
  const remote = page.data?.matches ?? [];
  const merged = mergeLocalMatches(remote, local.data ?? [], page.data?.hasMore ?? true);
  const fromClient = merged.length - remote.length;
  const plain = merged.map((m) => toSummary(m, p.puuid)).filter((s): s is MatchSummary => s !== null);
  // ±LP par partie : seulement celles qu'un releve encadre sans ambiguite, les autres
  // gardent `null` et s'affichent « Victoire » / « Défaite ».
  const lp = attributeLp(plain, ranks.data ?? []);
  const matches = plain.map((m) => (lp.has(m.id) ? { ...m, lpDelta: lp.get(m.id)! } : m));
  const top = championAggregates(matches)[0]?.champion ?? null;
  // Coequipiers : deux pages Riot, plus les parties du client sur la meme fenetre de temps.
  const seen = new Set(remote.map((m) => m.id));
  const deeper = [...remote, ...(more.data ?? []).filter((m) => !seen.has(m.id))];
  const mateMatches = mergeLocalMatches(deeper, local.data ?? [], true);
  return (
    <DashboardView
      demo={false}
      player={{ ...p, bannerChampion: top, bannerSkin: 0, updatedAt: p.fetchedAt }}
      matches={matches}
      teammates={frequentTeammates(mateMatches, p.puuid)}
      teammatesSample={mateMatches.length}
      plat={plat}
      awards={awardsByMatch(merged, p.puuid)}
      provenance={`Backend NEX · ${matches.length} parties chargées${fromClient > 0 ? ` (dont ${fromClient} ARAM Mayhem lues dans le client League)` : ""} · actualisé ${timeAgo(p.fetchedAt)}`}
      periods={["10", "20"]}
    />
  );
}

/**
 * Donnees lues en local (client League, enregistrements) : affichees meme quand le backend
 * ou Riot ne repond pas, pour que le dashboard ne soit pas vide (cle expiree, hors ligne).
 */
function LocalSections() {
  const { navigate } = useNav();
  if (platform.capabilities.kind !== "desktop") return null;
  return (
    <div className="dash-main" style={{ marginTop: 14 }}>
      <MediaRow />
      <div className="row-extras">
        <CollectionCard onOpen={() => navigate("collection")} />
      </div>
    </div>
  );
}

function DashHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <h1 className="page-title">
        <House aria-hidden="true" /> Dashboard
      </h1>
      <p className="page-sub">Tes performances récentes, ton rang, tes enregistrements et ta collection en un coup d'œil.</p>
      <div className="spacer" />
      {children}
    </div>
  );
}

function DashboardView({
  demo,
  player,
  matches: allMatches,
  teammates,
  teammatesSample = 0,
  plat,
  awards,
  provenance,
  periods,
}: {
  demo: boolean;
  player: DashPlayer;
  matches: MatchSummary[];
  /** Coequipiers frequents du compte reel ; absent en mode demo. */
  teammates?: Teammate[];
  teammatesSample?: number;
  plat?: string;
  /** Rang du joueur dans chaque partie, par identifiant de partie ; absent en mode demo. */
  awards?: Map<string, Award>;
  provenance: string;
  periods: string[];
}) {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const [queue, setQueue] = useState<QueueFilter>("all");
  const [period, setPeriod] = useState<string>(periods.includes("20") ? "20" : periods[0]);
  const [selected, setSelected] = useState<MetricKey | null>(null);

  const matches = useMemo(() => {
    const sorted = [...allMatches].sort((a, b) => b.startedAt - a.startedAt);
    const filtered = queue === "all" ? sorted : sorted.filter((m) => m.queue === queue);
    const n = Number(period);
    const out: MatchSummary[] = [];
    let counted = 0;
    for (const m of filtered) {
      if (counted >= n) break;
      out.push(m);
      if (isCountable(m)) counted++;
    }
    return out;
  }, [allMatches, queue, period]);

  const window = Math.max(3, Math.floor(Number(period) / 2));
  const summaries = useMemo(() => METRICS.map((d) => summarize(d, matches, window)), [matches, window]);
  const countable = matches.filter(isCountable);

  return (
    <div className="page">
      <DashHeader>
        <div className="dash-filters">
          {demo && <DemoTag />}
          <Segmented label="File" options={QUEUE_OPTIONS} value={queue} onChange={setQueue} />
          <Segmented label="Période" options={periods.map((p) => ({ value: p, label: p }))} value={period} onChange={setPeriod} />
          <div className="period-label">
            <strong className="num">{countable.length} parties</strong>
            <span>{QUEUE_OPTIONS.find((q) => q.value === queue)?.label}</span>
          </div>
        </div>
      </DashHeader>

      <div className="dash">
        <div className="dash-main">
          <Hero player={player} summaries={summaries} selected={selected} onSelect={setSelected} window={window} sample={countable.length} />

          {demo ? (
            <div className="row-media two">
              <button className="card card-link media-card full-card" onClick={() => navigate("recordings")} aria-label="Ouvrir le dernier enregistrement">
                <RemoteImg className="bg" src={championSplash(demoLastRecording.champion, demoLastRecording.skin)} alt="" />
                <div className="shade" />
                <div className="over">
                  <div className="badge-top">
                    <span className="result-badge">VICTOIRE</span>
                    <span className="time-badge num">{duration(demoLastRecording.durationSec)}</span>
                  </div>
                  <div className="bottom">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <ChampIcon version={version} champion={demoLastRecording.champion} size={28} rounded={14} />
                      <div>
                        <strong style={{ fontSize: "var(--fs-md)" }}>{demoLastRecording.title}</strong>
                        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                          {demoLastRecording.queueLabel} · {timeAgo(demoLastRecording.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div className="num" style={{ marginTop: 8, fontWeight: 700 }}>
                      {demoLastRecording.kda} <span className="muted">KDA</span>
                    </div>
                  </div>
                </div>
              </button>

              <div className="card clip-list">
                {demoClips.map((c) => (
                  <button key={c.id} className="clip-row" onClick={() => navigate("recordings")}>
                    <span className="clip-thumb">
                      <RemoteImg src={championLoading(c.champion, c.skin)} alt="" />
                      <span className="time-badge num">{duration(c.durationSec)}</span>
                    </span>
                    <span>
                      <strong>{c.title}</strong>
                      <span>{timeAgo(c.createdAt)}</span>
                    </span>
                  </button>
                ))}
                <button className="see-all" onClick={() => navigate("recordings")}>
                  Tout voir <ChevronRight size={11} style={{ verticalAlign: -1 }} />
                </button>
              </div>
            </div>
          ) : (
            <MediaRow />
          )}

          <div className="row-extras">
            <button className="card card-link overlay-card" onClick={() => navigate("overlays")}>
              {demo ? (
                <>
                  <div className="ov-timers num" aria-hidden="true">
                    <span style={{ color: "var(--gold)" }}>
                      <i /> 1:41
                    </span>
                    <span style={{ color: "var(--red)" }}>
                      <i /> 0:27
                    </span>
                    <span style={{ color: "var(--accent-strong)" }}>
                      <i /> 8:14
                    </span>
                  </div>
                  <div className="ov-widget" aria-hidden="true">
                    <header>
                      <span className="chip chip-accent" style={{ padding: "0 4px", fontSize: 9 }}>
                        NEX
                      </span>
                      Aperçu de widget
                    </header>
                    <dl className="num">
                      <dt>CS/min</dt>
                      <dd>7.1</dd>
                      <dd className="muted">6.8</dd>
                      <dt>KP</dt>
                      <dd>58%</dd>
                      <dd className="muted">52%</dd>
                      <dt>Vision/min</dt>
                      <dd>0.7</dd>
                      <dd className="muted">0.65</dd>
                    </dl>
                  </div>
                </>
              ) : (
                <OverlayPreview summaries={summaries} sample={countable.length} />
              )}
              <div className="card-title" style={{ marginTop: "auto" }}>
                <LayoutGrid aria-hidden="true" /> Overlays <ArrowUpRight aria-hidden="true" />
                <span className="spacer" />
                <span className="chip">Aperçu</span>
              </div>
            </button>

            {demo ? (
              <button className="card card-link collection-card" onClick={() => navigate("collection")}>
                <RemoteImg className="bg" src={championSplash(demoCollection.champion, 0)} alt="" />
                <div className="shade" style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(11,12,16,.95), rgba(11,12,16,.2) 65%)" }} />
                <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, display: "grid", gap: 8 }}>
                  <div className="card-title">
                    <Gem aria-hidden="true" /> Collection <ArrowUpRight aria-hidden="true" />
                    <span className="spacer" />
                    <DemoTag compact />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-xs)" }}>
                    <span className="muted">Skins possédés</span>
                    <span className="num">
                      <b>{demoCollection.owned}</b> / {demoCollection.total}
                    </span>
                  </div>
                  <div className="progress" role="progressbar" aria-valuenow={demoCollection.owned} aria-valuemax={demoCollection.total} aria-label="Progression de collection">
                    <span style={{ width: `${(demoCollection.owned / demoCollection.total) * 100}%` }} />
                  </div>
                </div>
              </button>
            ) : (
              <CollectionCard onOpen={() => navigate("collection")} />
            )}

            <LensCard matches={countable} />
          </div>
          <div className="provenance">
            {demo && <DemoTag compact />} {provenance} · Score NEX v{NEX_SCORE_VERSION} · repères provisoires
          </div>
        </div>

        <div className="dash-side">
          <RankCard ranks={player.ranks} />
          <RecentMatches matches={matches.slice(0, 6)} demo={demo} awards={awards} />
          <ChampionPerformance matches={matches} />
          {teammates && plat && <TeammatesCard mates={teammates} plat={plat} sample={teammatesSample} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Rangee « medias » du compte reel : derniere partie enregistree et clips recents
 * (enregistrements locaux). Aucune donnee d'exemple. Les amis en partie restent sur la
 * page Spectate ; leur carte d'accueil a cede la place au bloc « Streamers en direct ».
 */
function MediaRow() {
  const { navigate } = useNav();
  const version = useDDragonVersion();
  const desktop = platform.capabilities.kind === "desktop";
  const recs = useAsync<Recording[]>(desktop ? "recordings-list" : null, () => platform.recordingsList(), 30_000);
  const reloadRecs = recs.reload;
  useEffect(() => {
    if (!desktop) return;
    const off = platform.on("recordings://changed", () => reloadRecs());
    return () => void off.then((f) => f());
  }, [desktop, reloadRecs]);

  const sorted = useMemo(() => [...(recs.data ?? [])].sort((a, b) => b.createdAt - a.createdAt), [recs.data]);
  const lastFull = sorted.find((r) => r.kind === "full") ?? null;
  const clips = sorted.filter((r) => r.kind === "clip").slice(0, 3);
  const toRecordings = () => navigate("recordings");

  return (
    <div className="row-media two">
      {lastFull ? (
        <button className="card card-link media-card full-card" onClick={toRecordings} aria-label={`Ouvrir l'enregistrement ${lastFull.title}`}>
          {lastFull.thumb ? (
            <img className="bg" src={platform.assetUrl(lastFull.thumb)} alt="" loading="lazy" decoding="async" />
          ) : (
            lastFull.championKey && <RemoteImg className="bg" src={championSplash(lastFull.championKey, 0)} alt="" />
          )}
          <div className="shade" />
          <div className="over">
            <div className="badge-top">
              <span className="result-badge">{lastFull.complete ? "PARTIE COMPLÈTE" : "INCOMPLET"}</span>
              <span className="time-badge num">{duration(lastFull.durationMs / 1000)}</span>
            </div>
            <div className="bottom">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {lastFull.championKey && <ChampIcon version={version} champion={lastFull.championKey} size={28} rounded={14} />}
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: "var(--fs-md)" }}>{lastFull.title}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    {timeAgo(lastFull.createdAt)}
                  </div>
                </div>
              </div>
              {lastFull.kda && (
                <div className="num" style={{ marginTop: 8, fontWeight: 700 }}>
                  {lastFull.kda} <span className="muted">KDA</span>
                </div>
              )}
            </div>
          </div>
        </button>
      ) : (
        <PendingCard
          icon={<Film />}
          title="Dernier enregistrement"
          text={
            !desktop
              ? "Les enregistrements sont disponibles dans l'application desktop."
              : recs.data
                ? "Aucune partie enregistrée pour l'instant. Active la capture dans Enregistrements."
                : "Lecture de tes enregistrements…"
          }
          onClick={toRecordings}
        />
      )}

      {clips.length > 0 ? (
        <div className="card clip-list">
          {clips.map((c) => (
            <button key={c.id} className="clip-row" onClick={toRecordings}>
              <span className="clip-thumb">
                {c.thumb ? <img src={platform.assetUrl(c.thumb)} alt="" loading="lazy" decoding="async" /> : <span className="img-fallback">NEX</span>}
                <span className="time-badge num">{duration(c.durationMs / 1000)}</span>
              </span>
              <span style={{ minWidth: 0 }}>
                <strong>{c.title}</strong>
                <span>{timeAgo(c.createdAt)}</span>
              </span>
            </button>
          ))}
          <button className="see-all" onClick={toRecordings}>
            Tout voir <ChevronRight size={11} style={{ verticalAlign: -1 }} />
          </button>
        </div>
      ) : (
        <PendingCard
          icon={<Film />}
          title="Clips récents"
          text={
            !desktop
              ? "Les clips sont disponibles dans l'application desktop."
              : recs.data
                ? "Aucun clip pour l'instant. En partie, Ctrl+Alt+R sauvegarde le replay instantané."
                : "Lecture de tes clips…"
          }
          onClick={toRecordings}
        />
      )}
    </div>
  );
}

/** Variation recente vs precedente, au format de la metrique ; « ±0 » quand elle s'arrondit a zero. */
function deltaText(s: MetricSummary): string {
  if (s.delta === null) return "";
  const abs = s.def.deltaUnit === "pts" ? `${Math.round(Math.abs(s.delta))} pts` : s.def.format(Math.abs(s.delta));
  if (/^0([.,]0+)?( pts)?$/.test(abs)) return "±0";
  return `${s.delta > 0 ? "+" : "−"}${abs}`;
}

/** Apercu du widget d'overlay avec les vraies moyennes du joueur sur la periode choisie. */
function OverlayPreview({ summaries, sample }: { summaries: MetricSummary[]; sample: number }) {
  const rows = (["csPerMin", "killParticipation", "damagePerMin"] as MetricKey[])
    .map((k) => summaries.find((s) => s.def.key === k))
    .filter((s): s is MetricSummary => !!s);
  return (
    <div className="ov-widget" aria-hidden="true">
      <header>
        <span className="chip chip-accent" style={{ padding: "0 4px", fontSize: 9 }}>
          NEX
        </span>
        Tes moyennes · {sample} parties
      </header>
      <dl className="num">
        {rows.map((s) => (
          <div key={s.def.key} style={{ display: "contents" }}>
            <dt>{s.def.short === "CSM" ? "CS/min" : s.def.short}</dt>
            <dd>{s.value === null ? "—" : s.def.format(s.value)}</dd>
            <dd className="muted">{deltaText(s)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Collection reelle : inventaire lu dans le client League (ou dernier inventaire connu). */
function CollectionCard({ onOpen }: { onOpen: () => void }) {
  const { catalog: champCatalog } = useAppState();
  const catalog = useAsync<SkinCatalog>("skin-catalog", () => platform.skinCatalog(), 3_600_000);
  const inventory = useAsync<SkinInventory>("skin-inventory", () => platform.skinInventory(), 300_000);
  const counts = useMemo(() => {
    if (!catalog.data || !champCatalog || !inventory.data || inventory.data.source === "unknown") return null;
    const views = viewSkins(
      catalog.data.skins.filter((s) => champCatalog.champions[String(s.championId)]),
      inventory.data,
    );
    return { owned: views.filter((v) => v.state === "owned").length, total: views.length, source: inventory.data.source };
  }, [catalog.data, inventory.data, champCatalog]);
  if (!counts) {
    return (
      <PendingCard
        icon={<Gem />}
        title="Collection"
        text={inventory.data || inventory.error != null ? "Ouvre le client League pour lire tes skins." : "Lecture de ta collection…"}
        onClick={onOpen}
      />
    );
  }
  return (
    <button className="card card-link collection-card" onClick={onOpen}>
      <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, display: "grid", gap: 8 }}>
        <div className="card-title">
          <Gem aria-hidden="true" /> Collection <ArrowUpRight aria-hidden="true" />
          <span className="spacer" />
          {counts.source === "cache" && <span className="chip">dernier inventaire</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-xs)" }}>
          <span className="muted">Skins possédés</span>
          <span className="num">
            <b>{counts.owned}</b> / {counts.total}
          </span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={counts.owned} aria-valuemax={counts.total} aria-label="Progression de collection">
          <span style={{ width: `${counts.total ? (counts.owned / counts.total) * 100 : 0}%` }} />
        </div>
      </div>
    </button>
  );
}

function PendingCard({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button className="card card-link media-card pending-card" onClick={onClick}>
      <div className="over">
        <div className="card-title">
          {icon} {title}
        </div>
        <p className="muted" style={{ margin: "auto 0 0", fontSize: "var(--fs-sm)" }}>
          {text}
        </p>
      </div>
    </button>
  );
}

function Hero({
  player: p,
  summaries,
  selected,
  onSelect,
  window,
  sample,
}: {
  player: DashPlayer;
  summaries: MetricSummary[];
  selected: MetricKey | null;
  onSelect: (k: MetricKey | null) => void;
  window: number;
  sample: number;
}) {
  const version = useDDragonVersion();
  const { favorites, toggleFavorite } = useAppState();
  const { navigate } = useNav();
  const riotId = `${p.gameName}#${p.tagLine}`;
  const isFav = favorites.some((f) => `${f.gameName}#${f.tagLine}`.toLowerCase() === riotId.toLowerCase() && f.platform === p.platform);
  const sel = summaries.find((s) => s.def.key === selected) ?? null;

  return (
    <section className="card hero" aria-label="Profil et métriques">
      {p.bannerChampion && (
        <div className="hero-art" aria-hidden="true">
          <RemoteImg src={championSplash(p.bannerChampion, p.bannerSkin)} alt="" />
        </div>
      )}
      <div className="hero-top">
        <span className="avatar">
          <RemoteImg src={profileIcon(version, p.profileIconId)} alt="Icône de profil" fallback="NX" />
          <span className="hero-region">{platformLabel(p.platform)}</span>
          <span className="avatar-level num">{p.level}</span>
        </span>
        <div>
          <button className="hero-name" style={{ textAlign: "left" }} onClick={() => navigate("profile", { riotId, platform: p.platform })} title="Ouvrir le profil">
            {p.gameName}
          </button>
          <div className="hero-tag">#{p.tagLine}</div>
        </div>
        <div className="hero-actions">
          <button
            className="icon-btn boxed"
            aria-pressed={isFav}
            aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
            onClick={() => toggleFavorite(riotId, p.platform)}
            style={isFav ? { color: "var(--gold)" } : undefined}
          >
            <Star fill={isFav ? "currentColor" : "none"} />
          </button>
          <span className="compare">
            Variation : {window} dern. vs {window} préc.
          </span>
        </div>
      </div>

      <div className="metrics">
        {summaries.map((s) => {
          const tone = s.delta === null || s.delta === 0 ? "neutral" : (s.delta > 0) === s.def.higherIsBetter ? "pos" : "neg";
          return (
            <button
              key={s.def.key}
              className="metric"
              aria-pressed={selected === s.def.key}
              onClick={() => onSelect(selected === s.def.key ? null : s.def.key)}
              aria-label={`${s.def.label} : ${s.value === null ? "indisponible" : s.def.format(s.value)}. Détails`}
            >
              <span className="metric-label">{s.def.label}</span>
              <span className="metric-value num">{s.value === null ? "—" : s.def.format(s.value)}</span>
              <Sparkline values={s.series} tone={tone} label={`Évolution ${s.def.label}`} />
              <DeltaChip value={s.delta} unit={s.def.deltaUnit} higherIsBetter={s.def.higherIsBetter} />
            </button>
          );
        })}
      </div>

      {sel && (
        <div className="metric-explain" role="region" aria-label={`Détail ${sel.def.label}`}>
          <div>
            <strong>{sel.def.label}</strong> — {sel.def.help}
            <div className="muted" style={{ marginTop: 4 }}>
              Échantillon : {sel.sampleSize} partie{sel.sampleSize > 1 ? "s" : ""} avec donnée sur {sample} comptabilisée
              {sample > 1 ? "s" : ""} (remakes exclus).
              {sel.delta === null && " Variation non calculée : moins de 3 parties par bloc."}
            </div>
          </div>
          <MiniBars values={sel.series} />
        </div>
      )}
    </section>
  );
}

function MiniBars({ values }: { values: number[] }) {
  if (!values.length) return null;
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return (
    <div className="bars" aria-hidden="true">
      {values.slice(-30).map((v, i) => (
        <span key={i} style={{ height: `${8 + ((v - min) / span) * 26}px` }} />
      ))}
    </div>
  );
}

function RankCard({ ranks }: { ranks: DashPlayer["ranks"] }) {
  const [q, setQ] = useState<"RANKED_SOLO_5x5" | "RANKED_FLEX_SR">("RANKED_SOLO_5x5");
  const r = ranks.find((x) => x.queue === q);
  const wr = r ? winRate(r.wins, r.losses) : null;
  return (
    <section className="card rank-card" aria-label="Rang">
      <div>
        <Segmented
          label="File classée"
          options={[
            { value: "RANKED_SOLO_5x5", label: "Solo/Duo" },
            { value: "RANKED_FLEX_SR", label: "Flex" },
          ]}
          value={q}
          onChange={setQ}
        />
        {r ? (
          <>
            <div className="rank-tier" style={{ marginTop: 8 }}>
              {TIER_LABEL[r.tier] ?? r.tier} {r.division ?? ""}
            </div>
            <div className="rank-lp num">
              {r.lp} LP
              <span>
                {r.wins}V – {r.losses}D ({pct(wr)})
              </span>
            </div>
          </>
        ) : (
          <div className="rank-tier muted" style={{ marginTop: 8 }}>
            Non classé
          </div>
        )}
      </div>
      {r && <RankCrest tier={r.tier} size={78} />}
    </section>
  );
}

function RecentMatches({ matches, demo, awards }: { matches: MatchSummary[]; demo: boolean; awards?: Map<string, Award> }) {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  if (!matches.length) {
    return (
      <div className="card">
        <EmptyState title="Aucune partie">Aucune partie pour ce filtre.</EmptyState>
      </div>
    );
  }
  return (
    <section className="match-list" aria-label="Dernières parties">
      {matches.map((m) => {
        const result = m.remake ? "remake" : m.win ? "win" : "loss";
        const score = nexScore(m).score;
        return (
          <button
            key={m.id}
            className="match-row"
            data-result={result}
            onClick={() => navigate("profile")}
            aria-label={`${result === "win" ? "Victoire" : result === "loss" ? "Défaite" : "Remake"}, ${championName(m.champion)}, ${m.kills}/${m.deaths}/${m.assists}`}
          >
            <span className="match-meta">
              <b className={`num ${m.lpDelta === null ? (m.remake ? "" : m.win ? "win" : "loss") : m.lpDelta > 0 ? "win" : "loss"}`}>
                {m.remake ? "Remake" : m.lpDelta !== null ? `${m.lpDelta > 0 ? "+" : ""}${m.lpDelta} LP` : m.win ? "Victoire" : "Défaite"}
              </b>
              <span>{m.mayhem ? "ARAM Mayhem" : QUEUE_LABEL[m.queue]}</span>
              <span>{timeAgo(m.startedAt + m.durationSec * 1000)}</span>
            </span>
            <ChampIcon version={version} champion={m.champion} size={34} rounded={17} />
            <span className="match-kda">
              <b className="num">
                {m.kills} / <span className="loss">{m.deaths}</span> / {m.assists}
              </b>
              <span className="num">
                {m.deaths === 0 ? "Sans mort" : `${kdaOf(m.kills, m.deaths, m.assists).toFixed(1)} KDA`} · {duration(m.durationSec)}
              </span>
            </span>
            <ScoreRing value={m.remake ? null : score} label="Score NEX" rank={awards?.get(m.id)?.rankLabel ?? null} />
          </button>
        );
      })}
      <button className="btn btn-ghost btn-sm" onClick={() => navigate("profile")} style={{ justifySelf: "center" }}>
        Voir tout l'historique <ChevronRight />
      </button>
      {!demo && (
        <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: 0, textAlign: "center" }}>
          Variations de LP : Riot ne les fournit pas. NEX relève ton rang à chaque lecture de profil et affiche l'écart quand deux relevés encadrent une seule
          partie classée.
        </p>
      )}
    </section>
  );
}

function ChampionPerformance({ matches }: { matches: MatchSummary[] }) {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const champs = championAggregates(matches).slice(0, 3);
  const roles = roleDistribution(matches);
  return (
    <section className="card champ-perf" aria-label="Performances par champion">
      <div className="card-title" style={{ justifyContent: "center" }}>
        <Sparkles aria-hidden="true" /> Performances par champion
      </div>
      {champs.length ? (
        <div className="champ-perf-list">
          {champs.map((c) => (
            <button key={c.champion} onClick={() => navigate("champions", { champion: c.champion })}>
              <ChampIcon version={version} champion={c.champion} size={40} rounded={20} />
              <strong>{championName(c.champion)}</strong>
              <span className="num">
                {c.wins}V – {c.games - c.wins}D
              </span>
              <span className="num">{kdaOf(c.kills, c.deaths, c.assists).toFixed(1)} KDA</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center" }}>
          Aucune partie.
        </p>
      )}
      <div className="roles">
        {roles.map((r) => (
          <Tip key={r.role} text={`${ROLE_LABEL[r.role]} : ${r.games} partie(s), victoire ${pct(r.winRate)}`}>
            <div tabIndex={0}>
              <PositionIcon position={r.role} size={18} />
              <b className="num">{pct(r.share)}</b>
              <div className="bar">
                <i style={{ width: `${r.share * 100}%` }} />
              </div>
              <span>{ROLE_LABEL[r.role]}</span>
            </div>
          </Tip>
        ))}
      </div>
    </section>
  );
}

/** Analyse apres partie : composante la plus faible du score NEX sur la periode. */
function LensCard({ matches }: { matches: MatchSummary[] }) {
  const analysis = useMemo(() => {
    const totals = new Map<string, { sum: number; n: number; value: number; baseline: number }>();
    const scores: number[] = [];
    for (const m of [...matches].reverse()) {
      const b = nexScore(m);
      if (b.score === null) continue;
      scores.push(b.score);
      for (const c of b.components) {
        const t = totals.get(c.label) ?? { sum: 0, n: 0, value: 0, baseline: 0 };
        t.sum += c.contribution;
        t.n++;
        t.value += c.value;
        t.baseline += c.baseline;
        totals.set(c.label, t);
      }
    }
    let weakest: { label: string; value: number; baseline: number } | null = null;
    let worst = Infinity;
    for (const [label, t] of totals) {
      const avg = t.sum / t.n;
      if (avg < worst) {
        worst = avg;
        weakest = { label, value: t.value / t.n, baseline: t.baseline / t.n };
      }
    }
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return { scores, weakest, avg };
  }, [matches]);

  const fmt = (label: string, v: number) =>
    label === "Participation" || label === "Part des dégâts" ? pct(v) : v.toFixed(label === "Vision/min" ? 2 : 1);

  return (
    <section className="card lens-card" aria-label="Analyse NEX">
      <div className="card-title">
        <Sparkles aria-hidden="true" /> NEX Insight
      </div>
      <div style={{ flex: 1, display: "grid", alignItems: "center" }}>
        <Sparkline values={analysis.scores} width={180} height={52} label="Score NEX par partie" />
      </div>
      {analysis.weakest ? (
        <div style={{ fontSize: "var(--fs-xs)" }}>
          <div className="muted">Axe de progression</div>
          <div style={{ fontWeight: 600 }}>
            {analysis.weakest.label} : <span className="num">{fmt(analysis.weakest.label, analysis.weakest.value)}</span>{" "}
            <span className="muted">
              (repère <span className="num">{fmt(analysis.weakest.label, analysis.weakest.baseline)}</span>)
            </span>
          </div>
        </div>
      ) : (
        <div className="muted">Pas assez de parties.</div>
      )}
      <div className="lens-value num" style={{ marginTop: 6 }}>
        {analysis.avg === null ? "—" : Math.round(analysis.avg)}
        <small>/100</small>
      </div>
    </section>
  );
}
