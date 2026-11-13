import { ChartColumn, ChevronDown, ChevronUp, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { platform } from "../../platform";
import type { ChampionStatDto, TierListDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { pct, ROLE_LABEL } from "../../ui/format";
import { ChampIcon, EmptyState, PositionIcon } from "../../ui/primitives";
import { CollectorNote } from "../stats/CollectorNote";
import { paramsKey, RoleFilter, ScopeLine, StatsFilters, TierBadge, toParams, useChampionById, useStatsFilters, useStatsMeta, WinRate } from "../stats/statsShared";

type SortKey = "tier" | "winRate" | "games" | "pickRate" | "banRate" | "name";
const TIER_ORDER: Record<string, number> = { "S+": 0, S: 1, A: 2, B: 3, C: 4, D: 5, "?": 6 };

export function BuildsPage() {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const meta = useStatsMeta();
  const [filters] = useStatsFilters();
  const [role, setRole] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "tier", desc: false });
  const [showLow, setShowLow] = useState(false);
  const byId = useChampionById();
  const params = toParams(filters, role || undefined);
  const tl = useAsync<TierListDto>(`tierlist:${paramsKey(params)}`, () => platform.statsTierList(params), 60_000);
  const min = meta.data?.minGames ?? 20;

  const rows = useMemo(() => {
    const list = (tl.data?.champions ?? []).filter((c) => showLow || c.games >= min);
    const val = (c: ChampionStatDto): number | string => {
      switch (sort.key) {
        case "tier":
          return TIER_ORDER[c.tier] * 10 - c.adjustedWinRate;
        case "winRate":
          return c.games ? c.wins / c.games : 0;
        case "games":
          return c.games;
        case "pickRate":
          return c.pickRate;
        case "banRate":
          return c.banRate;
        case "name":
          return byId(c.championId)?.name ?? "";
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const r = typeof x === "string" ? x.localeCompare(y as string, "fr") : (x as number) - (y as number);
      return sort.desc ? -r : r;
    });
  }, [tl.data, sort, showLow, min, byId]);

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="th-sort" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "tier" && k !== "name" }))}>
        {children}
        {sort.key === k && (sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
      </button>
    </th>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <ChartColumn aria-hidden="true" /> Builds & tier lists
        </h1>
        <p className="page-sub">Classement des champions par poste sur les parties collectées, avec effectifs et méthode explicite.</p>
        <div className="spacer" />
        <StatsFilters meta={meta.data} />
      </div>
      <CollectorNote meta={meta.data} />
      <div className="grid-toolbar">
        <RoleFilter value={role} onChange={setRole} />
        <label className="check">
          <input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} /> Afficher les échantillons &lt; {min} parties
        </label>
        <span className="spacer" />
        {tl.data && <ScopeLine scope={tl.data.scope} min={min} />}
      </div>

      {tl.error != null ? (
        <ErrorPanel error={tl.error} onRetry={() => tl.reload()} />
      ) : !tl.data ? (
        <div className="card card-pad muted">Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Pas encore de champion classable">
            {tl.data.scope.matches} parties collectées dans ce périmètre. Un champion est classé à partir de {min} parties à un poste ; coche « Afficher les échantillons » pour voir les tendances.
          </EmptyState>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <Th k="name">Champion</Th>
                <th scope="col">Poste</th>
                <Th k="tier">Tier</Th>
                <Th k="winRate">Victoires</Th>
                <Th k="games">Parties</Th>
                <Th k="pickRate">Pick</Th>
                <Th k="banRate">Ban</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const champ = byId(c.championId);
                return (
                  <tr key={`${c.championId}-${c.position}`} onClick={() => champ && navigate("champions", { champion: champ.key, role: c.position })} className="clickable">
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <button
                        className="cell-champ"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (champ) navigate("champions", { champion: champ.key, role: c.position });
                        }}
                      >
                        <ChampIcon version={version} champion={champ?.key ?? "Unknown"} size={28} rounded={7} />
                        <span>{champ?.name ?? c.championId}</span>
                      </button>
                    </td>
                    <td>
                      <span className="cell-role">
                        <PositionIcon position={c.position} size={16} /> {ROLE_LABEL[c.position] ?? c.position}
                      </span>
                    </td>
                    <td>
                      <TierBadge tier={c.tier} />
                    </td>
                    <td title={`Taux ajusté : ${pct(c.adjustedWinRate, 1)}`}>
                      <WinRate wins={c.wins} games={c.games} min={min} />
                    </td>
                    <td className="num">{c.games}</td>
                    <td className="num">{pct(c.pickRate, 1)}</td>
                    <td className="num">{pct(c.banRate, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="card card-pad method">
        <summary>
          <Info size={14} /> Méthode de classement
        </summary>
        <p>
          Pour chaque champion et chaque poste : taux de victoire ajusté = (victoires + 20) / (parties + 40). Ce retrait vers 50 % évite qu'un
          champion joué 3 fois avec 3 victoires soit classé premier. Tiers : S+ ≥ 53,5 %, S ≥ 52 %, A ≥ 50,5 %, B ≥ 49 %, C ≥ 47,5 %, D en dessous ;
          « ? » sous {min} parties. Le pick rate rapporte les parties du champion à ce poste au nombre de parties collectées ; le ban rate compte
          les parties où il est banni, tous postes confondus.
        </p>
        <p>
          Source : parties Solo/Duo récentes des joueurs Maître et plus, collectées par le backend NEX. Le filtre « Rang » porte sur le rang du joueur
          dont la partie a été collectée. Ces statistiques décrivent des corrélations observées. Ce ne sont pas des recommandations garanties.
        </p>
      </details>
    </div>
  );
}
