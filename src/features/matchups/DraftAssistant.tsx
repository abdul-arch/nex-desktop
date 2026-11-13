import { Ban, RotateCcw, Search, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useClient } from "../../app/ClientContext";
import { useAsync } from "../../app/useAsync";
import { championLoading } from "../../data/assets";
import { platform } from "../../platform";
import type { ChampionBuildDto, MatchupsDto, TierListDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { pct, ROLE_LABEL } from "../../ui/format";
import { ChampIcon, EmptyState, PositionIcon, RemoteImg } from "../../ui/primitives";
import { BuildView } from "../stats/BuildView";
import { paramsKey, TierBadge, toParams, useChampionById, useChampionList, useStatsFilters, useStatsMeta } from "../stats/statsShared";
import { composition, ROLES, suggest, type Slot } from "./draftLogic";

// ---------- Etat du draft (conserve pendant la session) ----------

interface DraftState {
  allies: Slot[];
  enemies: Slot[];
  allyBans: (number | null)[];
  enemyBans: (number | null)[];
  me: number;
}

const fresh = (): DraftState => ({
  allies: ROLES.map((role) => ({ championId: null, role })),
  enemies: ROLES.map((role) => ({ championId: null, role })),
  allyBans: [null, null, null, null, null],
  enemyBans: [null, null, null, null, null],
  me: 2,
});
let draft: DraftState = fresh();
const subs = new Set<() => void>();
function useDraft(): [DraftState, (f: (d: DraftState) => DraftState) => void] {
  const s = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => draft,
  );
  return [
    s,
    (f) => {
      draft = f(draft);
      subs.forEach((x) => x());
    },
  ];
}

type Target = { side: "ally" | "enemy"; kind: "pick" | "ban"; index: number };

export function DraftAssistant() {
  const version = useDDragonVersion();
  const { catalog } = useAppState();
  const meta = useStatsMeta();
  const [filters] = useStatsFilters();
  const byId = useChampionById();
  const [d, setD] = useDraft();
  const [target, setTarget] = useState<Target | null>(null);
  const { champSelect } = useClient();
  const [sync, setSync] = useState(true);

  // Synchronisation avec la selection des champions du client (lecture seule).
  useEffect(() => {
    if (!sync || !champSelect) return;
    setD((s) => {
      const toSlots = (team: typeof champSelect.myTeam, fallback: Slot[]): Slot[] =>
        fallback.map((f, i) => {
          const p = team[i];
          const role = (p?.position as Slot["role"]) ?? f.role;
          return { role, championId: p && p.championId > 0 ? p.championId : null };
        });
      const meIndex = champSelect.myTeam.findIndex((p) => p.cellId === champSelect.localCell);
      const bans = (ids: number[]) => [0, 1, 2, 3, 4].map((i) => ids[i] ?? null);
      return {
        allies: toSlots(champSelect.myTeam, s.allies),
        enemies: toSlots(champSelect.theirTeam, s.enemies),
        allyBans: bans(champSelect.myBans),
        enemyBans: bans(champSelect.theirBans),
        me: meIndex >= 0 ? meIndex : s.me,
      };
    });
  }, [champSelect, sync]); // eslint-disable-line react-hooks/exhaustive-deps
  const min = meta.data?.minGames ?? 20;
  const nameOf = (id: number) => byId(id)?.name ?? String(id);

  const used = new Set<number>(
    [...d.allies, ...d.enemies].map((s) => s.championId).concat(d.allyBans, d.enemyBans).filter((x): x is number => x !== null),
  );
  const mySlot = d.allies[d.me];
  const laneEnemy = d.enemies.find((e) => e.role === mySlot.role && e.championId);

  const tierParams = toParams(filters, mySlot.role);
  const tier = useAsync<TierListDto>(`tierlist:${paramsKey(tierParams)}`, () => platform.statsTierList(tierParams), 60_000);
  const enemyParams = toParams(filters, mySlot.role);
  const enemyMu = useAsync<MatchupsDto>(
    laneEnemy?.championId ? `matchups:${laneEnemy.championId}:${paramsKey(enemyParams)}` : null,
    () => platform.statsMatchups(laneEnemy!.championId!, enemyParams),
    60_000,
  );
  const allTier = useAsync<TierListDto>(`tierlist:${paramsKey(toParams(filters))}`, () => platform.statsTierList(toParams(filters)), 60_000);
  const tierOf = (id: number | null, role: string) => allTier.data?.champions.find((c) => c.championId === id && c.position === role)?.tier ?? null;

  const suggestions = useMemo(
    () => suggest(tier.data?.champions ?? [], laneEnemy ? enemyMu.data ?? null : null, used, Math.max(5, Math.floor(min / 2)), nameOf),
    [tier.data, enemyMu.data, laneEnemy, used.size, min], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const buildParams = toParams(filters, mySlot.role);
  const build = useAsync<ChampionBuildDto>(
    mySlot.championId ? `build:${mySlot.championId}:${paramsKey(buildParams)}` : null,
    () => platform.statsBuild(mySlot.championId!, buildParams),
    60_000,
  );

  const comp = (slots: Slot[]) =>
    composition(slots.filter((s) => s.championId).map((s) => catalog?.champions[String(s.championId)] ?? { attack: 0, magic: 0, tags: [] }));
  const allyComp = comp(d.allies);
  const enemyComp = comp(d.enemies);

  const assign = (id: number | null) => {
    if (!target) return;
    setD((s) => {
      const next = { ...s, allies: [...s.allies], enemies: [...s.enemies], allyBans: [...s.allyBans], enemyBans: [...s.enemyBans] };
      if (target.kind === "ban") (target.side === "ally" ? next.allyBans : next.enemyBans)[target.index] = id;
      else {
        const arr = target.side === "ally" ? next.allies : next.enemies;
        arr[target.index] = { ...arr[target.index], championId: id };
      }
      return next;
    });
    setTarget(null);
  };

  const Card = ({ slot, i, side }: { slot: Slot; i: number; side: "ally" | "enemy" }) => {
    const c = slot.championId ? byId(slot.championId) : null;
    const t = tierOf(slot.championId, slot.role);
    const isMe = side === "ally" && d.me === i;
    return (
      <div className={`draft-card ${side} ${isMe ? "me" : ""}`}>
        <button className="draft-card-art" onClick={() => setTarget({ side, kind: "pick", index: i })} aria-label={`${side === "ally" ? "Allié" : "Ennemi"} ${ROLE_LABEL[slot.role]} : ${c?.name ?? "vide"}. Choisir un champion`}>
          {c ? <RemoteImg src={championLoading(c.key)} alt="" /> : <span className="draft-empty">+</span>}
          <span className="draft-card-foot">
            <PositionIcon position={slot.role} size={14} />
            {t && <TierBadge tier={t} />}
          </span>
        </button>
        <div className="draft-card-tools">
          <select
            className="select mini"
            value={slot.role}
            onChange={(e) =>
              setD((s) => {
                const arr = [...(side === "ally" ? s.allies : s.enemies)];
                arr[i] = { ...arr[i], role: e.target.value as Slot["role"] };
                return side === "ally" ? { ...s, allies: arr } : { ...s, enemies: arr };
              })
            }
            aria-label="Poste"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          {side === "ally" && (
            <button className={`icon-btn ${isMe ? "on" : ""}`} aria-pressed={isMe} title="C'est moi" onClick={() => setD((s) => ({ ...s, me: i }))}>
              <User size={13} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const Bans = ({ side }: { side: "ally" | "enemy" }) => (
    <div className={`draft-bans ${side}`}>
      {(side === "ally" ? d.allyBans : d.enemyBans).map((b, i) => (
        <button key={i} className="draft-ban" onClick={() => setTarget({ side, kind: "ban", index: i })} aria-label={`Bannissement ${i + 1} : ${b ? nameOf(b) : "vide"}`}>
          {b ? <ChampIcon version={version} champion={byId(b)?.key ?? "Unknown"} size={26} rounded={4} /> : <Ban size={12} />}
        </button>
      ))}
    </div>
  );

  return (
    <div className="draft">
      <div className="draft-top">
        <Bans side="ally" />
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {champSelect ? (
            <label className="check">
              <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Synchronisé avec le client
            </label>
          ) : (
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              Mode manuel (aucune sélection en cours dans le client)
            </span>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => setD(() => fresh())}>
            <RotateCcw /> Réinitialiser
          </button>
        </span>
        <Bans side="enemy" />
      </div>
      <div className="draft-band">
        <div className="draft-team">
          {d.allies.map((s, i) => (
            <Card key={i} slot={s} i={i} side="ally" />
          ))}
        </div>
        <CompositionPanel ally={allyComp} enemy={enemyComp} />
        <div className="draft-team">
          {d.enemies.map((s, i) => (
            <Card key={i} slot={s} i={i} side="enemy" />
          ))}
        </div>
      </div>

      <section className="card card-pad">
        <div className="card-title" style={{ marginBottom: 8 }}>
          Choix proposés pour toi ({ROLE_LABEL[mySlot.role]})
          {laneEnemy?.championId && <span className="muted" style={{ fontWeight: 400 }}> · face à {nameOf(laneEnemy.championId)}</span>}
        </div>
        {tier.error != null ? (
          <ErrorPanel error={tier.error} onRetry={() => tier.reload()} compact />
        ) : suggestions.length === 0 ? (
          <p className="muted">Pas assez de parties collectées à ce poste pour proposer des choix argumentés.</p>
        ) : (
          <div className="suggestions">
            {suggestions.map((s) => {
              const c = byId(s.championId);
              return (
                <button
                  key={s.championId}
                  className="suggestion"
                  onClick={() => {
                    setD((st) => {
                      const allies = [...st.allies];
                      allies[st.me] = { ...allies[st.me], championId: s.championId };
                      return { ...st, allies };
                    });
                  }}
                >
                  <ChampIcon version={version} champion={c?.key ?? "Unknown"} size={36} rounded={8} />
                  <span>
                    <strong>{c?.name}</strong>
                    {s.reasons.map((r) => (
                      <span key={r} className="muted">
                        {r}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "8px 0 0" }}>
          Classement explicable : taux de victoire ajusté au poste, plus l'avantage de ligne pondéré par l'effectif. Ce n'est pas une probabilité de
          victoire : aucun modèle prédictif évalué n'est utilisé. Le choix reste le tien.
        </p>
      </section>

      {mySlot.championId ? (
        build.error != null ? (
          <ErrorPanel error={build.error} onRetry={() => build.reload()} />
        ) : build.data ? (
          <BuildView build={build.data} min={min} />
        ) : (
          <div className="card card-pad muted">Chargement du build…</div>
        )
      ) : (
        <div className="card">
          <EmptyState title="Choisis ton champion">Clique sur ta carte (marquée « moi ») ou sur une proposition pour afficher runes, sorts et objets.</EmptyState>
        </div>
      )}

      {target && <ChampionGridModal disabled={used} onPick={assign} onClose={() => setTarget(null)} title={target.kind === "ban" ? "Bannir un champion" : `Choisir un champion (${target.side === "ally" ? "allié" : "ennemi"})`} />}
    </div>
  );
}

function CompositionPanel({ ally, enemy }: { ally: ReturnType<typeof composition>; enemy: ReturnType<typeof composition> }) {
  const Row = ({ label, p, side }: { label: string; p: ReturnType<typeof composition>; side: "ally" | "enemy" }) => (
    <div className="comp-row">
      <span className="muted">{label}</span>
      <div className="comp-bar" aria-label={`${label} : ${p.physicalShare === null ? "inconnu" : `${Math.round(p.physicalShare * 100)} % physique`}`}>
        <i className="ad" style={{ width: `${(p.physicalShare ?? 0.5) * 100}%` }} />
        <i className="ap" style={{ width: `${(1 - (p.physicalShare ?? 0.5)) * 100}%` }} />
      </div>
      <span className="num muted" style={{ fontSize: "var(--fs-xs)" }}>
        {p.physicalShare === null ? "—" : `${pct(p.physicalShare)} AD`} · {p.frontline} tank{p.frontline > 1 ? "s" : ""}
      </span>
      {p.notes.map((n) => (
        <span key={n} className={`comp-note ${side}`}>
          {n}
        </span>
      ))}
    </div>
  );
  return (
    <div className="draft-center">
      <div className="panel-label" style={{ justifyContent: "center" }}>
        Comparaison des compositions
      </div>
      <Row label="Alliés" p={ally} side="ally" />
      <Row label="Ennemis" p={enemy} side="enemy" />
      <p className="muted" style={{ fontSize: 10.5, margin: 0, textAlign: "center" }}>
        Profil indicatif (notes Data Dragon physique/magique et classes). Pas de pourcentage de victoire.
      </p>
    </div>
  );
}

function ChampionGridModal({ disabled, onPick, onClose, title }: { disabled: Set<number>; onPick: (id: number | null) => void; onClose: () => void; title: string }) {
  const version = useDDragonVersion();
  const list = useChampionList();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const shown = list.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette picker-modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="palette-input">
          <Search aria-hidden="true" />
          <input
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={title}
            aria-label={title}
            onKeyDown={(e) => {
              const first = shown.find((c) => !disabled.has(c.id));
              if (e.key === "Enter" && first) onPick(first.id);
            }}
          />
          <button className="btn btn-sm" onClick={() => onPick(null)}>
            Vider
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </div>
        <div className="picker-grid">
          {shown.map((c) => (
            <button key={c.id} disabled={disabled.has(c.id)} onClick={() => onPick(c.id)} title={c.name}>
              <ChampIcon version={version} champion={c.key} size={44} rounded={8} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
