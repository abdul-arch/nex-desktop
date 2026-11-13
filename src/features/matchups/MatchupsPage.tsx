import { ChevronDown, ChevronLeft, ChevronUp, Crosshair, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { championSplash } from "../../data/assets";
import { platform } from "../../platform";
import type { ChampionBuildDto, MatchupDto, MatchupsDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { duration, pct, ROLE_LABEL, timeAgo } from "../../ui/format";
import { ChampIcon, EmptyState, RemoteImg, Segmented } from "../../ui/primitives";
import { BuildView } from "../stats/BuildView";
import { CollectorNote } from "../stats/CollectorNote";
import { ChampionPicker, paramsKey, RoleFilter, ScopeLine, StatsFilters, toParams, useChampionById, useStatsFilters, useStatsMeta } from "../stats/statsShared";
import { DistributionChart, FAVORABLE_PP } from "./DistributionChart";
import { DraftAssistant } from "./DraftAssistant";
import { usePersonalMatchups, type PersonalDuel } from "./usePersonalMatchups";

export function MatchupsPage() {
  const { location, navigate } = useNav();
  const tab = location.params?.tab === "draft" ? "draft" : "matchups";
  const meta = useStatsMeta();
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <Crosshair aria-hidden="true" /> Matchups
        </h1>
        <div className="spacer" />
        <StatsFilters meta={meta.data} />
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "matchups"} onClick={() => navigate("matchups", { ...location.params, tab: "matchups" })}>
          Matchups
        </button>
        <button role="tab" aria-selected={tab === "draft"} onClick={() => navigate("matchups", { tab: "draft" })}>
          Assistant de sélection
        </button>
      </div>
      <CollectorNote meta={meta.data} />
      {tab === "draft" ? <DraftAssistant /> : location.params?.vs ? <DuelView /> : <MatchupsView />}
    </div>
  );
}

function useMatchupsData(championId: number | null, role: string) {
  const [filters] = useStatsFilters();
  const params = toParams(filters, role || undefined);
  return useAsync<MatchupsDto>(championId ? `matchups:${championId}:${paramsKey(params)}` : null, () => platform.statsMatchups(championId!, params), 60_000);
}

type SortKey = "winRate" | "delta" | "games";

function MatchupsView() {
  const version = useDDragonVersion();
  const { location, navigate } = useNav();
  const meta = useStatsMeta();
  const byId = useChampionById();
  const championId = location.params?.champion ? Number(location.params.champion) : null;
  const role = location.params?.role ?? "";
  const [oppQuery, setOppQuery] = useState("");
  const minDefault = Math.max(3, Math.floor((meta.data?.minGames ?? 20) / 4));
  const [minGames, setMinGames] = useState<number>(minDefault);
  const mu = useMatchupsData(championId, role);
  const personal = usePersonalMatchups(championId);
  const champ = championId ? byId(championId) : null;
  const nameOf = (id: number) => byId(id)?.name ?? String(id);
  const keyOf = (id: number) => byId(id)?.key ?? "Unknown";
  const setParams = (p: Record<string, string | undefined>) => {
    const next = { ...location.params, ...p };
    navigate("matchups", Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Record<string, string>);
  };

  const data = mu.data;
  const shown = useMemo(() => (data?.matchups ?? []).filter((m) => m.games >= minGames), [data, minGames]);
  const fav = shown.filter((m) => m.deltaPp >= FAVORABLE_PP);
  const hard = shown.filter((m) => m.deltaPp <= -FAVORABLE_PP);
  const even = shown.length - fav.length - hard.length;
  const hardest = [...shown].sort((a, b) => a.deltaPp - b.deltaPp)[0];
  const easiest = [...shown].sort((a, b) => b.deltaPp - a.deltaPp)[0];
  const counters = [...shown].sort((a, b) => a.deltaPp - b.deltaPp).slice(0, 3);
  const q = oppQuery.trim().toLowerCase();
  const matchQ = (m: MatchupDto) => !q || nameOf(m.opponentId).toLowerCase().includes(q);
  const highlighted = q ? shown.find(matchQ)?.opponentId ?? null : null;

  return (
    <>
      <div className="mu-toolbar">
        <ChampionPicker value={championId} onChange={(id) => setParams({ champion: id ? String(id) : undefined, role: undefined })} placeholder="Choisir un champion" />
        <RoleFilter value={data?.position ?? role} onChange={(r) => setParams({ role: r || undefined })} allowAll={false} />
        <span className="muted">c.</span>
        <label className="search-box">
          <Search size={14} aria-hidden="true" />
          <input value={oppQuery} onChange={(e) => setOppQuery(e.target.value)} placeholder="N'importe quel adversaire" aria-label="Filtrer les adversaires" />
        </label>
        <label className="field">
          <span>Effectif min.</span>
          <select className="select" value={minGames} onChange={(e) => setMinGames(Number(e.target.value))} aria-label="Effectif minimal par adversaire">
            {[1, 3, 5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        {data && champ && (
          <span className="muted num" style={{ fontSize: "var(--fs-sm)" }}>
            {champ.name} ({ROLE_LABEL[data.position] ?? data.position}) : <b className="text">{pct(data.games ? data.wins / data.games : null, 1)}</b> sur{" "}
            {data.games.toLocaleString("fr-FR")} parties
          </span>
        )}
      </div>

      {!championId ? (
        <div className="card">
          <EmptyState icon={<Crosshair />} title="Choisis un champion">
            La distribution place chaque adversaire selon l'écart entre le taux de victoire du champion contre lui et son taux moyen au même poste, sur le même périmètre.
          </EmptyState>
        </div>
      ) : mu.error != null ? (
        <ErrorPanel error={mu.error} onRetry={() => mu.reload()} />
      ) : !data ? (
        <div className="card card-pad muted">Chargement…</div>
      ) : (
        <>
          {counters.length > 0 && (
            <div className="counters-band">
              <span className="muted">Les meilleurs picks contre {champ?.name}</span>
              {counters.map((m) => (
                <button key={m.opponentId} className="counter-chip" onClick={() => setParams({ vs: String(m.opponentId) })}>
                  <ChampIcon version={version} champion={keyOf(m.opponentId)} size={22} rounded={5} />
                  {nameOf(m.opponentId)}{" "}
                  <b className="num win">
                    +{Math.abs(m.deltaPp).toFixed(1)}
                  </b>
                </button>
              ))}
            </div>
          )}

          <section className="card card-pad">
            <div className="card-title" style={{ marginBottom: 2 }}>
              Répartition des matchups{" "}
              <span className="muted" style={{ fontWeight: 400, fontSize: "var(--fs-xs)" }}>
                {shown.length} adversaires autour de la moyenne de {champ?.name} ({pct(data.averageWinRate, 1)}) · ≥ {minGames} parties chacun
              </span>
            </div>
            <ScopeLine scope={data.scope} games={data.games} min={meta.data?.minGames ?? 20} />
            {shown.length ? (
              <DistributionChart
                matchups={shown}
                average={data.averageWinRate}
                nameOf={nameOf}
                keyOf={keyOf}
                highlight={highlighted}
                onOpen={(id) => setParams({ vs: String(id) })}
              />
            ) : (
              <EmptyState title="Aucun adversaire avec assez de parties">Baisse l'effectif minimal ou élargis le périmètre (patch, région).</EmptyState>
            )}
            <div className="mu-counts">
              <div>
                <span>Favorable</span>
                <b className="num win">{fav.length}</b>
              </div>
              <div>
                <span>Équilibré</span>
                <b className="num">{even}</b>
              </div>
              <div>
                <span>Difficile</span>
                <b className="num loss">{hard.length}</b>
              </div>
              {hardest && (
                <div>
                  <span>Le plus difficile</span>
                  <b>
                    <ChampIcon version={version} champion={keyOf(hardest.opponentId)} size={18} rounded={4} /> {nameOf(hardest.opponentId)}{" "}
                    <span className="num loss">−{Math.abs(hardest.deltaPp).toFixed(1)}</span>
                  </b>
                </div>
              )}
              {easiest && (
                <div>
                  <span>Le plus facile</span>
                  <b>
                    <ChampIcon version={version} champion={keyOf(easiest.opponentId)} size={18} rounded={4} /> {nameOf(easiest.opponentId)}{" "}
                    <span className="num win">+{Math.abs(easiest.deltaPp).toFixed(1)}</span>
                  </b>
                </div>
              )}
              <p className="muted">
                Seuils : favorable ≥ +{FAVORABLE_PP} pts, difficile ≤ −{FAVORABLE_PP} pts par rapport au taux moyen du champion. « pts » = points de
                pourcentage ; le pourcentage relatif est indiqué au survol.
              </p>
            </div>
          </section>

          <div className="mu-tables">
            <MatchupTable title="Fort contre" rows={fav.concat(shown.filter((m) => m.deltaPp > 0 && m.deltaPp < FAVORABLE_PP)).filter(matchQ)} nameOf={nameOf} keyOf={keyOf} personal={personal} onOpen={(id) => setParams({ vs: String(id) })} />
            <MatchupTable title="Faible contre" rows={hard.concat(shown.filter((m) => m.deltaPp <= 0 && m.deltaPp > -FAVORABLE_PP)).filter(matchQ)} nameOf={nameOf} keyOf={keyOf} personal={personal} onOpen={(id) => setParams({ vs: String(id) })} />
          </div>
        </>
      )}
    </>
  );
}

function MatchupTable({
  title,
  rows,
  nameOf,
  keyOf,
  personal,
  onOpen,
}: {
  title: string;
  rows: MatchupDto[];
  nameOf: (id: number) => string;
  keyOf: (id: number) => string;
  personal: ReturnType<typeof usePersonalMatchups>;
  onOpen: (id: number) => void;
}) {
  const version = useDDragonVersion();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "winRate", desc: title === "Fort contre" });
  const sorted = [...rows].sort((a, b) => {
    const v = (m: MatchupDto) => (sort.key === "winRate" ? m.winRate : sort.key === "delta" ? m.deltaPp : m.games);
    return sort.desc ? v(b) - v(a) : v(a) - v(b);
  });
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="th-sort" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : true }))}>
        {children}
        {sort.key === k && (sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
      </button>
    </th>
  );
  return (
    <section className="card table-card">
      <div className="card-title card-pad" style={{ paddingBottom: 6 }}>
        {title} <span className="muted" style={{ fontWeight: 400, fontSize: "var(--fs-xs)" }}>{rows.length} adversaires</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Adversaire</th>
            <Th k="winRate">Taux de victoire</Th>
            <Th k="delta">Écart</Th>
            <Th k="games">Parties</Th>
            <th scope="col" title={personal.linked ? `Tes résultats sur tes ${personal.sample} dernières parties` : "Lie ton compte pour voir tes résultats"}>
              Vous
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const me: PersonalDuel | undefined = personal.byOpponent.get(m.opponentId);
            return (
              <tr key={m.opponentId} className="clickable" onClick={() => onOpen(m.opponentId)}>
                <td>
                  <button
                    className="cell-champ"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(m.opponentId);
                    }}
                  >
                    <ChampIcon version={version} champion={keyOf(m.opponentId)} size={24} rounded={6} />
                    <span>{nameOf(m.opponentId)}</span>
                  </button>
                </td>
                <td className="num">{pct(m.winRate, 1)}</td>
                <td className={`num ${m.deltaPp >= 0 ? "pos" : "neg"}`}>
                  {m.deltaPp >= 0 ? "+" : "−"}
                  {Math.abs(m.deltaPp).toFixed(1)}
                </td>
                <td className="num">{m.games.toLocaleString("fr-FR")}</td>
                <td className="num">{me ? `${me.wins}V ${me.losses}D` : "–"}</td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Aucun adversaire.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function DuelView() {
  const version = useDDragonVersion();
  const { location, navigate } = useNav();
  const meta = useStatsMeta();
  const byId = useChampionById();
  const [filters] = useStatsFilters();
  const championId = Number(location.params?.champion);
  const opponentId = Number(location.params?.vs);
  const role = location.params?.role ?? "";
  const mu = useMatchupsData(championId, role);
  const params = toParams(filters, mu.data?.position ?? (role || undefined));
  const build = useAsync<ChampionBuildDto>(mu.data ? `build:${championId}:${paramsKey(params)}` : null, () => platform.statsBuild(championId, params), 60_000);
  const personal = usePersonalMatchups(championId);
  const [view, setView] = useState<"build" | "games">("build");
  const champ = byId(championId);
  const opp = byId(opponentId);
  const min = meta.data?.minGames ?? 20;
  const d = mu.data?.matchups.find((m) => m.opponentId === opponentId);
  const mine = personal.byOpponent.get(opponentId);

  return (
    <>
      <button className="btn btn-sm btn-ghost" onClick={() => navigate("matchups", { champion: String(championId), ...(role ? { role } : {}) })}>
        <ChevronLeft /> Tous les matchups de {champ?.name}
      </button>
      <section className="card duel-hero">
        <div className="duel-art" aria-hidden="true">
          <RemoteImg src={champ ? championSplash(champ.key) : null} alt="" />
          <RemoteImg src={opp ? championSplash(opp.key) : null} alt="" />
        </div>
        <div className="duel-body">
          <div className="duel-side">
            <ChampIcon version={version} champion={champ?.key ?? "Unknown"} size={64} rounded={14} />
            <strong>{champ?.name}</strong>
          </div>
          <div className="duel-center">
            <span className="muted">{mu.data ? ROLE_LABEL[mu.data.position] : ""} · contre</span>
            {mu.error != null ? (
              <ErrorPanel error={mu.error} onRetry={() => mu.reload()} compact />
            ) : !mu.data ? (
              <span className="muted">Chargement…</span>
            ) : d ? (
              <>
                <b className={`duel-wr num ${d.games < min ? "low-sample" : d.winRate >= 0.5 ? "win" : "loss"}`}>{pct(d.winRate, 1)}</b>
                <span className="num">
                  {d.wins}V / {d.games - d.wins}D · écart{" "}
                  <b className={d.deltaPp >= 0 ? "pos" : "neg"}>
                    {d.deltaPp >= 0 ? "+" : "−"}
                    {Math.abs(d.deltaPp).toFixed(1)} pts
                  </b>{" "}
                  vs moyenne {pct(mu.data.averageWinRate, 1)}
                </span>
                {d.games < min && <span className="warn-chip">Petit échantillon ({d.games} parties) : à confirmer</span>}
              </>
            ) : (
              <span className="muted">Aucune partie collectée pour ce duel dans ce périmètre.</span>
            )}
          </div>
          <div className="duel-side">
            <ChampIcon version={version} champion={opp?.key ?? "Unknown"} size={64} rounded={14} />
            <strong>{opp?.name}</strong>
          </div>
        </div>
      </section>
      {mu.data && <ScopeLine scope={mu.data.scope} games={d?.games} min={min} />}

      <div className="duel-grid">
        <section className="card card-pad">
          <div className="panel-label">Tes parties dans ce duel</div>
          {!personal.linked ? (
            <p className="muted">Lie ton compte (Profil › « C'est mon compte », mode démo désactivé) pour voir tes parties.</p>
          ) : mine ? (
            <>
              <p className="num">
                <b>{mine.wins}V – {mine.losses}D</b> <span className="muted">sur tes {personal.sample} dernières parties chargées</span>
              </p>
              {mine.matches.map((m) => (
                <div key={m.id} className="muted num" style={{ fontSize: "var(--fs-xs)" }}>
                  {timeAgo(m.startedAt)} · {duration(m.durationSec)} · {m.id}
                </div>
              ))}
            </>
          ) : (
            <p className="muted">Aucune partie de ce duel parmi tes {personal.sample} dernières parties.</p>
          )}
        </section>
        <section className="card card-pad">
          <div className="panel-label">Conseils</div>
          <p className="muted">
            Aucun conseil éditorial vérifié pour ce duel. NEX n'affichera que des conseils signés et datés, distingués des statistiques.
          </p>
          <div className="panel-label">VOD et parties de référence</div>
          <p className="muted">Aucune VOD vérifiée pour ce duel.</p>
        </section>
      </div>

      <div className="section-head">
        <h2>Build de {champ?.name}</h2>
        <Segmented
          label="Vue"
          options={[
            { value: "build", label: "Build général au poste" },
            { value: "games", label: "Limites" },
          ]}
          value={view}
          onChange={setView}
        />
      </div>
      {view === "games" ? (
        <div className="card card-pad muted">
          Le build affiché est celui de {champ?.name} à ce poste sur tout le périmètre. Avec l'échantillon actuel, un build spécifique à ce duel serait
          trop peu fiable. Il sera ajouté quand chaque duel atteindra le seuil de {min} parties.
        </div>
      ) : build.error != null ? (
        <ErrorPanel error={build.error} onRetry={() => build.reload()} />
      ) : build.data ? (
        <BuildView build={build.data} min={min} />
      ) : (
        <div className="card card-pad muted">Chargement du build…</div>
      )}
    </>
  );
}
