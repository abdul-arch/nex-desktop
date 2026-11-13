// Briques communes aux ecrans statistiques : filtres de perimetre persistants, meta,
// badges d'echantillon et selection de champion.
import { Search } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useAsync } from "../../app/useAsync";
import { platformLabel } from "../../domain/riotId";
import { platform } from "../../platform";
import type { StatsMetaDto, StatsParams, StatsScopeDto } from "../../platform/api";
import { pct, ROLE_LABEL } from "../../ui/format";
import { ChampIcon, PositionIcon, Segmented, Tip } from "../../ui/primitives";

// ---------- Filtres partages entre ecrans (conserves pendant la session) ----------

export interface StatsFilterState {
  patch: string; // "" = dernier patch
  queue: number;
  tier: string;
  platform: string;
}

let filterState: StatsFilterState = { patch: "", queue: 420, tier: "all", platform: "all" };
const listeners = new Set<() => void>();

export function useStatsFilters(): [StatsFilterState, (patch: Partial<StatsFilterState>) => void] {
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => filterState,
  );
  const set = (p: Partial<StatsFilterState>) => {
    filterState = { ...filterState, ...p };
    listeners.forEach((l) => l());
  };
  return [state, set];
}

export function toParams(f: StatsFilterState, position?: string | null): StatsParams {
  return {
    patch: f.patch || undefined,
    queue: f.queue,
    tier: f.tier,
    platform: f.platform,
    position: position ?? undefined,
  };
}

export function paramsKey(p: StatsParams): string {
  return `${p.patch ?? ""}|${p.queue ?? ""}|${p.tier ?? ""}|${p.platform ?? ""}|${p.position ?? ""}`;
}

export function useStatsMeta() {
  return useAsync<StatsMetaDto>("stats-meta", () => platform.statsMeta(), 30_000);
}

export const TIER_NAMES: Record<string, string> = {
  all: "Master+",
  CHALLENGER: "Challenger",
  GRANDMASTER: "Grand Maître",
  MASTER: "Maître",
};

export function StatsFilters({ meta, extra }: { meta: StatsMetaDto | null; extra?: React.ReactNode }) {
  const [f, set] = useStatsFilters();
  const patches = meta?.patches ?? [];
  return (
    <div className="stats-filters">
      <label className="field">
        <span>Patch</span>
        <select className="select" value={f.patch} onChange={(e) => set({ patch: e.target.value })} aria-label="Patch">
          <option value="">Dernier{patches[0] ? ` (${patches[0][0]})` : ""}</option>
          {patches.map(([p, n]) => (
            <option key={p} value={p}>
              {p} · {n} parties
            </option>
          ))}
          <option value="all">Tous les patchs</option>
        </select>
      </label>
      <Segmented
        label="File"
        options={[
          { value: "420", label: "Solo/Duo" },
          { value: "440", label: "Flex", hint: "Le collecteur ne récolte que la Solo/Duo pour l'instant" },
        ]}
        value={String(f.queue)}
        onChange={(v) => set({ queue: Number(v) })}
      />
      <label className="field">
        <span>Rang</span>
        <select className="select" value={f.tier} onChange={(e) => set({ tier: e.target.value })} aria-label="Rang">
          {Object.entries(TIER_NAMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Région</span>
        <select className="select" value={f.platform} onChange={(e) => set({ platform: e.target.value })} aria-label="Région">
          <option value="all">Toutes</option>
          {(meta?.platforms ?? []).map(([p, n]) => (
            <option key={p} value={p}>
              {platformLabel(p)} · {n}
            </option>
          ))}
        </select>
      </label>
      {extra}
    </div>
  );
}

export function RoleFilter({
  value,
  onChange,
  allowAll = true,
  counts,
}: {
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  counts?: Map<string, number>;
}) {
  const roles = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
  return (
    <div className="role-filter" role="radiogroup" aria-label="Poste">
      {allowAll && (
        <button role="radio" aria-checked={value === ""} onClick={() => onChange("")} title="Tous les postes">
          Tous
        </button>
      )}
      {roles.map((r) => (
        <button
          key={r}
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          title={`${ROLE_LABEL[r]}${counts?.get(r) !== undefined ? ` · ${counts.get(r)} parties` : ""}`}
          disabled={counts !== undefined && !counts.get(r)}
        >
          <PositionIcon position={r} size={16} />
          <span className="sr-only">{ROLE_LABEL[r]}</span>
        </button>
      ))}
    </div>
  );
}

/** Rappel du perimetre et avertissement d'echantillon. */
export function ScopeLine({ scope, games, min }: { scope: StatsScopeDto; games?: number; min: number }) {
  const small = games !== undefined && games < min;
  return (
    <div className="scope-line">
      <span>
        Patch {scope.patch === "all" ? "tous" : scope.patch} · {scope.queueId === 420 ? "Solo/Duo" : "Flex"} · {TIER_NAMES[scope.tier] ?? scope.tier} ·{" "}
        {scope.platform === "all" ? "toutes régions" : platformLabel(scope.platform)} · <b className="num">{scope.matches}</b> parties collectées
      </span>
      {small && (
        <span className="warn-chip">
          Échantillon faible ({games} &lt; {min} parties) : tendance indicative
        </span>
      )}
    </div>
  );
}

export function WinRate({ wins, games, min }: { wins: number; games: number; min: number }) {
  if (!games) return <span className="muted">—</span>;
  const wr = wins / games;
  return (
    <Tip text={`${wins} victoires sur ${games} parties${games < min ? " — échantillon faible" : ""}`}>
      <span tabIndex={0} className={`num ${games < min ? "low-sample" : wr >= 0.5 ? "win" : "loss"}`}>
        {pct(wr, 1)}
      </span>
    </Tip>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span className="tier-badge" data-tier={tier} title={tier === "?" ? "Échantillon insuffisant pour classer" : `Tier ${tier}`}>
      {tier}
    </span>
  );
}

/** Liste des champions du catalogue, triee par nom. */
export function useChampionList() {
  const { catalog } = useAppState();
  return useMemo(
    () =>
      Object.entries(catalog?.champions ?? {})
        .map(([id, c]) => ({ id: Number(id), ...c }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [catalog],
  );
}

export function useChampionById() {
  const { catalog } = useAppState();
  return (id: number) => {
    const c = catalog?.champions[String(id)];
    return c ? { id, ...c } : null;
  };
}

/** Selecteur de champion avec recherche (combobox accessible). */
export function ChampionPicker({
  value,
  onChange,
  placeholder = "Choisir un champion",
  exclude = [],
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  exclude?: number[];
}) {
  const version = useDDragonVersion();
  const list = useChampionList();
  const byId = useChampionById();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = value ? byId(value) : null;
  const results = list.filter((c) => !exclude.includes(c.id) && (!q || c.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 40);

  const pick = (id: number) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="champ-picker">
      <div className="champ-picker-input" onClick={() => inputRef.current?.focus()}>
        {current ? <ChampIcon version={version} champion={current.key} size={22} rounded={5} /> : <Search size={14} className="muted" />}
        <input
          ref={inputRef}
          value={open ? q : current?.name ?? ""}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQ("");
            setActive(0);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              pick(results[active].id);
              inputRef.current?.blur();
            } else if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls="champ-picker-list"
          aria-label={placeholder}
          spellCheck={false}
        />
        {current && (
          <button className="clear" onClick={() => onChange(null)} aria-label="Effacer le champion">
            ×
          </button>
        )}
      </div>
      {open && (
        <ul className="champ-picker-list" id="champ-picker-list" role="listbox">
          {results.length === 0 && <li className="muted">Aucun champion</li>}
          {results.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c.id);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <ChampIcon version={version} champion={c.key} size={22} rounded={5} /> {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
