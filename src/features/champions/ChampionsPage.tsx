import { ChevronLeft, ChevronRight, Crosshair, Search, Star, Swords, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { championLoading, championSplash } from "../../data/assets";
import { skillLabel } from "../../domain/fromMatch";
import { platform } from "../../platform";
import type { ChampionBuildDto, ChampionInfo, MatchupsDto, TierListDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { pct, ROLE_LABEL } from "../../ui/format";
import { ChampIcon, EmptyState, PositionIcon, RemoteImg } from "../../ui/primitives";
import { BuildView } from "../stats/BuildView";
import {
  paramsKey,
  RoleFilter,
  ScopeLine,
  StatsFilters,
  TierBadge,
  toParams,
  useChampionById,
  useChampionList,
  useStatsFilters,
  useStatsMeta,
} from "../stats/statsShared";

const CLASSES: Record<string, string> = {
  Assassin: "Assassin",
  Fighter: "Combattant",
  Mage: "Mage",
  Marksman: "Tireur",
  Support: "Support",
  Tank: "Tank",
};

export function ChampionsPage() {
  const { location } = useNav();
  const key = location.params?.champion;
  return key ? <ChampionDetail champKey={key} initialRole={location.params?.role} /> : <ChampionGrid />;
}

function useFavorites() {
  const { settings, setSetting } = useAppState();
  // Reglage absent si enregistre par une version anterieure : liste vide.
  const favs = settings.favoriteChampions ?? [];
  const toggle = (id: number) =>
    setSetting("favoriteChampions", favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]);
  return { favs, toggle };
}

function ChampionGrid() {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const list = useChampionList();
  const meta = useStatsMeta();
  const [filters] = useStatsFilters();
  const { favs, toggle } = useFavorites();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [cls, setCls] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const params = toParams(filters);
  const tl = useAsync<TierListDto>(`tierlist:${paramsKey(params)}`, () => platform.statsTierList(params), 60_000);

  // Poste principal et tier de chaque champion dans le perimetre.
  const statsById = useMemo(() => {
    const m = new Map<number, { role: string; tier: string; games: number; wins: number; roles: Set<string> }>();
    for (const c of tl.data?.champions ?? []) {
      const cur = m.get(c.championId);
      if (!cur || c.games > cur.games) m.set(c.championId, { role: c.position, tier: c.tier, games: c.games, wins: c.wins, roles: cur?.roles ?? new Set() });
      m.get(c.championId)!.roles.add(c.position);
    }
    return m;
  }, [tl.data]);

  const shown = list.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (onlyFav && !favs.includes(c.id)) return false;
    if (cls && !c.tags.includes(cls)) return false;
    if (role) {
      const s = statsById.get(c.id);
      if (!s || !s.roles.has(role)) return false;
    }
    return true;
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <Swords aria-hidden="true" /> Champions
        </h1>
        <p className="page-sub">Compétences, builds observés, matchups et skins de chaque champion.</p>
        <div className="spacer" />
        <StatsFilters meta={meta.data} />
      </div>

      <div className="grid-toolbar">
        <label className="search-box">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un champion" aria-label="Rechercher un champion" />
        </label>
        <RoleFilter value={role} onChange={setRole} />
        <select className="select" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Classe">
          <option value="">Toutes les classes</option>
          {Object.entries(CLASSES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" aria-pressed={onlyFav} onClick={() => setOnlyFav((v) => !v)}>
          <Star fill={onlyFav ? "currentColor" : "none"} style={onlyFav ? { color: "var(--gold)" } : undefined} /> Favoris
        </button>
        <span className="spacer" />
        <span className="muted num" style={{ fontSize: "var(--fs-xs)" }}>
          {shown.length} champions
          {role && !tl.data?.champions.length ? " · aucun poste connu (pas encore de statistiques)" : ""}
        </span>
      </div>

      {list.length === 0 ? (
        <div className="card card-pad muted">Chargement du catalogue Data Dragon…</div>
      ) : (
        <div className="champ-grid">
          {shown.map((c) => {
            const s = statsById.get(c.id);
            const fav = favs.includes(c.id);
            return (
              <div key={c.id} className="champ-card">
                <button className="champ-card-main" onClick={() => navigate("champions", { champion: c.key, ...(role ? { role } : {}) })} aria-label={`Ouvrir ${c.name}`}>
                  <ChampIcon version={version} champion={c.key} size={56} rounded={12} />
                  <strong>{c.name}</strong>
                  <span className="champ-card-meta">
                    {s ? (
                      <>
                        <PositionIcon position={s.role} size={13} />
                        <TierBadge tier={s.tier} />
                      </>
                    ) : (
                      <span className="muted">{c.tags.map((t) => CLASSES[t] ?? t).join(" · ")}</span>
                    )}
                  </span>
                </button>
                <button className={`fav-btn ${fav ? "on" : ""}`} aria-pressed={fav} aria-label={fav ? `Retirer ${c.name} des favoris` : `Ajouter ${c.name} aux favoris`} onClick={() => toggle(c.id)}>
                  <Star size={13} fill={fav ? "currentColor" : "none"} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChampionDetail({ champKey, initialRole }: { champKey: string; initialRole?: string }) {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const { settings } = useAppState();
  const meta = useStatsMeta();
  const [filters] = useStatsFilters();
  const { favs, toggle } = useFavorites();
  const [role, setRole] = useState(initialRole ?? "");
  const info = useAsync<ChampionInfo>(`champ-info:${champKey}`, () => platform.championInfo(champKey), 3_600_000);
  const id = info.data?.id ?? null;
  const params = toParams(filters, role || undefined);
  const build = useAsync<ChampionBuildDto>(id ? `build:${id}:${paramsKey(params)}` : null, () => platform.statsBuild(id!, params), 60_000);
  // Poste resolu par le backend (poste le plus joue si non choisi).
  const resolvedRole = build.data?.position ?? role;
  const mParams = toParams(filters, resolvedRole || undefined);
  const mu = useAsync<MatchupsDto>(id && resolvedRole ? `matchups:${id}:${paramsKey(mParams)}` : null, () => platform.statsMatchups(id!, mParams), 60_000);
  const min = meta.data?.minGames ?? 20;
  const byId = useChampionById();
  const [skin, setSkin] = useState<number | null>(null);

  if (info.error != null) return <div className="page"><ErrorPanel error={info.error} onRetry={() => info.reload()} /></div>;
  if (!info.data) return <div className="page"><div className="card card-pad muted">Chargement de la fiche…</div></div>;
  const c = info.data;
  const fav = favs.includes(c.id);
  const counts = new Map(build.data?.positions ?? []);
  const reliable = (mu.data?.matchups ?? []).filter((m) => m.games >= Math.max(3, Math.floor(min / 4)));
  const best = [...reliable].sort((a, b) => b.deltaPp - a.deltaPp).slice(0, 4);
  const worst = [...reliable].sort((a, b) => a.deltaPp - b.deltaPp).slice(0, 4);

  return (
    <div className="page">
      <section className="card champ-hero">
        <div className="hero-art" aria-hidden="true">
          <RemoteImg src={championSplash(c.key, 0)} alt="" />
        </div>
        <button className="btn btn-sm btn-ghost back-link" onClick={() => navigate("champions")}>
          <ChevronLeft /> Tous les champions
        </button>
        <div className="champ-hero-body">
          <ChampIcon version={version} champion={c.key} size={84} rounded={16} />
          <div>
            <h1 className="hero-name" style={{ margin: 0 }}>
              {c.name}
            </h1>
            <div className="muted" style={{ fontSize: "var(--fs-md)", textTransform: "capitalize" }}>
              {c.title}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {c.tags.map((t) => (
                <span key={t} className="chip">
                  {CLASSES[t] ?? t}
                </span>
              ))}
              <span className="chip">{c.resource || "Sans ressource"}</span>
            </div>
          </div>
          <div className="spacer" />
          <div className="champ-hero-actions">
            <button className="btn" aria-pressed={fav} onClick={() => toggle(c.id)}>
              <Star fill={fav ? "currentColor" : "none"} style={fav ? { color: "var(--gold)" } : undefined} /> {fav ? "Favori" : "Ajouter aux favoris"}
            </button>
            <button className="btn btn-primary" onClick={() => navigate("matchups", { champion: String(c.id), ...(resolvedRole ? { role: resolvedRole } : {}) })}>
              <Crosshair /> Matchups
            </button>
          </div>
        </div>
      </section>

      <section className="card card-pad" style={{ marginTop: 14 }}>
        <div className="panel-label">Compétences</div>
        <div className="abilities">
          {[{ key: "P", s: c.passive, kind: "passive" as const }, ...c.spells.map((s, i) => ({ key: skillLabel(i + 1, settings.abilityKeys), s, kind: "spell" as const }))].map(({ key, s, kind }) => (
            <article key={key} className="ability">
              <span className="ability-icon">
                <RemoteImg
                  src={s.image && version ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/${kind}/${s.image}` : null}
                  alt={s.name}
                  fallback={key}
                />
                <kbd className="skill-key">{key}</kbd>
              </span>
              <div>
                <strong>{s.name}</strong>
                {(s.cooldown || s.cost) && (
                  <div className="muted num" style={{ fontSize: "var(--fs-xs)" }}>
                    {s.cooldown && `Délai : ${s.cooldown} s`} {s.cost && s.cost !== "0" && `· Coût : ${s.cost}`}
                  </div>
                )}
                <p>{s.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="section-head">
        <h2>Build observé</h2>
        <RoleFilter value={resolvedRole} onChange={setRole} allowAll={false} counts={counts.size ? counts : undefined} />
        <span className="spacer" />
        <StatsFilters meta={meta.data} />
      </div>
      {build.data && <ScopeLine scope={build.data.scope} games={build.data.games} min={min} />}
      {build.error != null ? (
        <ErrorPanel error={build.error} onRetry={() => build.reload()} />
      ) : !build.data ? (
        <div className="card card-pad muted">Chargement des statistiques…</div>
      ) : (
        <>
          <div className="build-summary num">
            <span>
              {ROLE_LABEL[build.data.position] ?? build.data.position} · <b>{build.data.games}</b> parties ·{" "}
              <b className={build.data.games >= min ? (build.data.wins / Math.max(1, build.data.games) >= 0.5 ? "win" : "loss") : "low-sample"}>
                {pct(build.data.games ? build.data.wins / build.data.games : null, 1)}
              </b>{" "}
              de victoires
            </span>
          </div>
          <BuildView build={build.data} min={min} />
        </>
      )}

      <div className="section-head">
        <h2>Matchups à ce poste</h2>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => navigate("matchups", { champion: String(c.id), ...(resolvedRole ? { role: resolvedRole } : {}) })}>
          Tous les matchups <ChevronRight />
        </button>
      </div>
      {mu.data && reliable.length ? (
        <div className="mu-columns">
          {[
            { title: "Plus favorables", list: best, cls: "win" },
            { title: "Plus difficiles", list: worst, cls: "loss" },
          ].map((col) => (
            <div key={col.title} className="card card-pad">
              <div className="panel-label">{col.title}</div>
              {col.list.map((m) => {
                const o = byId(m.opponentId);
                return (
                  <button key={m.opponentId} className="mu-mini" onClick={() => navigate("matchups", { champion: String(c.id), role: resolvedRole, vs: String(m.opponentId) })}>
                    <ChampIcon version={version} champion={o?.key ?? "Unknown"} size={26} rounded={13} />
                    <span>{o?.name ?? m.opponentId}</span>
                    <span className="spacer" />
                    <span className={`num ${m.deltaPp >= 0 ? "pos" : "neg"}`}>
                      {m.deltaPp >= 0 ? "+" : "−"}
                      {Math.abs(m.deltaPp).toFixed(1)} pts
                    </span>
                    <span className="muted num" style={{ width: 54, textAlign: "right" }}>
                      {m.games} p.
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState title="Pas encore assez de matchups">
            Il faut au moins {Math.max(3, Math.floor(min / 4))} parties par adversaire pour les afficher ici.
          </EmptyState>
        </div>
      )}

      <div className="section-head">
        <h2>Skins</h2>
        <span className="muted">{c.skins.length} apparences</span>
      </div>
      <div className="skin-grid">
        {c.skins.map((s, i) => (
          <button key={s.num} className="skin-card" onClick={() => setSkin(i)} aria-label={`Agrandir ${s.name === "default" ? c.name : s.name}`}>
            <RemoteImg src={championLoading(c.key, s.num)} alt="" />
            <span>{s.name === "default" ? "Classique" : s.name}</span>
          </button>
        ))}
      </div>
      {skin !== null && <SkinViewer champKey={c.key} skins={c.skins} index={skin} onIndex={setSkin} onClose={() => setSkin(null)} />}
    </div>
  );
}

/** Apercu agrandi : charge le splash haute definition seulement a l'ouverture. */
function SkinViewer({
  champKey,
  skins,
  index,
  onIndex,
  onClose,
}: {
  champKey: string;
  skins: ChampionInfo["skins"];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restore.current = document.activeElement as HTMLElement;
    ref.current?.focus();
    return () => restore.current?.focus?.();
  }, []);
  const s = skins[index];
  const go = (d: number) => onIndex((index + d + skins.length) % skins.length);
  return (
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="skin-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={s.name}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        <RemoteImg src={championSplash(champKey, s.num)} alt={s.name} />
        <div className="skin-viewer-bar">
          <button className="icon-btn" onClick={() => go(-1)} aria-label="Skin précédent">
            <ChevronLeft />
          </button>
          <strong>{s.name === "default" ? "Classique" : s.name}</strong>
          <span className="muted num">
            {index + 1} / {skins.length}
          </span>
          <button className="icon-btn" onClick={() => go(1)} aria-label="Skin suivant">
            <ChevronRight />
          </button>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Fermer (Échap)">
            <X />
          </button>
        </div>
      </div>
    </div>
  );
}
