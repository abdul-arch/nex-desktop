// Data Studio : un catalogue de mesures nommees, et pour chacune le classement de tes
// champions, compare a la mediane des parties que NEX a collectees.
//
// Les deux chiffres n'ont pas la meme nature et la page le dit : ta valeur vient de TES
// parties chargees, la mediane vient des parties collectees par le backend. Quand la
// collecte ne porte pas la mesure, la colonne reste vide au lieu d'afficher un repere faux.
import { ClipboardCopy, FileChartColumn, Plus, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import { championName, profileIcon } from "../../data/assets";
import { parseRiotId, platformLabel } from "../../domain/riotId";
import { byChampion, STUDIO_CATEGORIES, STUDIO_STATS, studioStat, toCsv, toStudioRows, type StudioStat } from "../../domain/studio";
import { errorMessage, platform } from "../../platform";
import type { BaselinesDto, IconsDto, MatchDto, MatchPageDto, PlayerProfileDto } from "../../platform/api";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { pct, QUEUE_LABEL, ROLE_LABEL } from "../../ui/format";
import { ChampIcon, EmptyState, RemoteImg } from "../../ui/primitives";

const MAX_GAMES = 100;
const PAGE = 20;

export function DataStudioPage() {
  const { settings } = useAppState();
  const { location, navigate } = useNav();
  const riotId = location.params?.riotId ?? settings.linkedRiotId;
  const plat = location.params?.platform ?? settings.linkedPlatform;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">
          <FileChartColumn aria-hidden="true" /> Data Studio
        </h1>
        {riotId && (
          <span className="muted">
            {riotId} · {platformLabel(plat)}
          </span>
        )}
        <div className="spacer" />
      </div>
      {riotId && parseRiotId(riotId).ok ? (
        <Studio key={`${plat}:${riotId}`} riotId={riotId} plat={plat} />
      ) : (
        <div className="card">
          <EmptyState
            icon={<Settings />}
            title="Aucun compte lié"
            action={
              <button className="btn btn-primary" onClick={() => navigate("settings")}>
                Lier mon compte
              </button>
            }
          >
            Data Studio analyse tes parties réelles : lie ton Riot ID dans Paramètres (ou via « C'est mon compte » sur ton profil).
          </EmptyState>
        </div>
      )}
    </div>
  );
}

function Studio({ riotId, plat }: { riotId: string; plat: string }) {
  const { notify } = useAppState();
  const profile = useAsync<PlayerProfileDto>(`profile:${plat}:${riotId.toLowerCase()}`, () => platform.playerProfile(riotId, plat), 60_000);
  const puuid = profile.data?.puuid;
  // Meme cle et memes parametres que le dashboard : premiere page servie depuis le cache.
  const first = useAsync<MatchPageDto>(
    puuid ? `dash-matches:${plat}:${puuid}` : null,
    () => platform.playerMatches({ platform: plat, puuid: puuid!, start: 0, count: PAGE, timelines: 10 }),
    120_000,
  );
  const [extra, setExtra] = useState<MatchDto[]>([]);
  const [more, setMore] = useState<{ loading: boolean; hasMore: boolean | null }>({ loading: false, hasMore: null });
  const [queue, setQueue] = useState<string>("all");
  const [role, setRole] = useState<string>("all");
  const [champ, setChamp] = useState<string>("all");
  const [statKey, setStatKey] = useState<string>("csPerMin");

  // Medianes des joueurs collectes, au meme poste que le filtre choisi.
  const baselines = useAsync<BaselinesDto>(
    `baselines:${role}`,
    () => platform.statsBaselines(role === "all" ? {} : { position: role }),
    600_000,
  );

  const matches = useMemo(() => [...(first.data?.matches ?? []), ...extra], [first.data, extra]);
  const allRows = useMemo(() => (puuid ? toStudioRows(matches, puuid) : []), [matches, puuid]);
  const rows = useMemo(
    () => allRows.filter((r) => (queue === "all" || r.queue === queue) && (role === "all" || r.role === role) && (champ === "all" || r.champion === champ)),
    [allRows, queue, role, champ],
  );
  const champions = useMemo(() => [...new Set(allRows.map((r) => r.champion))].sort(), [allRows]);
  const hasMore = more.hasMore ?? first.data?.hasMore ?? false;
  const stat = studioStat(statKey);

  const loadMore = async () => {
    if (!puuid || matches.length >= MAX_GAMES) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const p = await platform.playerMatches({ platform: plat, puuid, start: matches.length, count: PAGE, timelines: 0 });
      setExtra((e) => [...e, ...p.matches]);
      setMore({ loading: false, hasMore: p.hasMore });
    } catch (e) {
      notify(errorMessage(e), "error");
      setMore((m) => ({ ...m, loading: false }));
    }
  };

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(rows));
      notify(`${rows.length} parties copiées au format CSV (séparateur « ; »).`, "success");
    } catch (e) {
      notify(`Copie impossible : ${errorMessage(e)}`, "error");
    }
  };

  if (profile.error != null && !profile.data) return <ErrorPanel error={profile.error} onRetry={() => profile.reload()} />;
  if (first.error != null && !first.data) return <ErrorPanel error={first.error} onRetry={() => first.reload()} />;
  if (!first.data) return <div className="card card-pad muted">Chargement des parties…</div>;

  const baseline = baselines.data?.stats.find((s) => s.key === stat.key) ?? null;

  return (
    <div className="studio-layout">
      <aside className="studio-nav" aria-label="Mesures">
        {STUDIO_CATEGORIES.map((c) => {
          const list = STUDIO_STATS.filter((s) => s.category === c.key);
          if (!list.length) return null;
          return (
            <div key={c.key}>
              <div className="studio-nav-title">{c.label}</div>
              {list.map((s) => (
                <button key={s.key} className={`studio-nav-item ${s.key === statKey ? "active" : ""}`} aria-current={s.key === statKey} onClick={() => setStatKey(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          );
        })}
        <div>
          <div className="studio-nav-title">Joueurs</div>
          <button className={`studio-nav-item ${statKey === ICONS_KEY ? "active" : ""}`} aria-current={statKey === ICONS_KEY} onClick={() => setStatKey(ICONS_KEY)}>
            Icônes d'invocateur
          </button>
        </div>
      </aside>

      <section className="studio-main">
        <div className="studio-toolbar">
          <label className="field">
            <span>File</span>
            <select className="select" value={queue} onChange={(e) => setQueue(e.target.value)}>
              <option value="all">Toutes</option>
              {["solo", "flex", "normal", "aram"].map((q) => (
                <option key={q} value={q}>
                  {QUEUE_LABEL[q]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Poste</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="all">Tous</option>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Champion</span>
            <select className="select" value={champ} onChange={(e) => setChamp(e.target.value)}>
              <option value="all">Tous</option>
              {champions.map((c) => (
                <option key={c} value={c}>
                  {championName(c)}
                </option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <span className="muted num" style={{ fontSize: "var(--fs-sm)" }}>
            {rows.length} parties retenues / {matches.length} chargées
          </span>
          <button className="btn btn-sm" onClick={loadMore} disabled={!hasMore || more.loading || matches.length >= MAX_GAMES}>
            <Plus /> {more.loading ? "Chargement…" : `${PAGE} parties de plus`}
          </button>
          <button className="btn btn-sm" onClick={copyCsv} disabled={!rows.length}>
            <ClipboardCopy /> Copier en CSV
          </button>
        </div>

        {statKey === ICONS_KEY ? (
          <IconsPanel />
        ) : (
          <>
            <StatHeader stat={stat} rows={rows} baseline={baseline} baselineSample={baselines.data?.sample ?? 0} />

            {rows.length === 0 ? (
              <div className="card">
                <EmptyState title="Aucune partie retenue">Élargis les filtres ou charge plus de parties.</EmptyState>
              </div>
            ) : (
              <ChampionTable stat={stat} rows={rows} />
            )}
          </>
        )}

        <p className="studio-note muted">
          {statKey === ICONS_KEY
            ? "Les icônes viennent des parties que NEX collecte lui-même, pas de ton historique. Une icône n'a aucun effet sur une partie : le taux de victoire n'est affiché que pour les icônes assez portées, et il ne décrit qu'une association."
            : `Tes valeurs viennent des ${rows.length} parties retenues ci-dessus (remakes, parties de moins de 5 min et Arena exclus). La médiane vient des parties que NEX collecte lui-même, jamais d'un autre site. Les comparaisons victoire / défaite décrivent des associations sur ton échantillon, pas des causes.`}
        </p>
      </section>
    </div>
  );
}

/** Clé réservée du catalogue : cette entrée n'est pas une mesure de tes parties. */
const ICONS_KEY = "profileIcons";

/**
 * Icônes d'invocateur les plus portées dans les parties collectées par NEX.
 * Rien à voir avec ton historique : c'est une photographie de ce que portent les joueurs
 * rencontrés dans l'échantillon collecté.
 */
function IconsPanel() {
  const version = useDDragonVersion();
  const icons = useAsync<IconsDto>("stats-icons", () => platform.statsIcons({}), 600_000);
  if (icons.error != null && !icons.data) return <ErrorPanel error={icons.error} onRetry={() => icons.reload()} compact />;
  if (!icons.data) return <div className="card card-pad muted">Lecture des icônes collectées…</div>;
  const { icons: list, sample, minPlayers } = icons.data;

  if (list.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Aucune icône collectée">
          NEX n'a pas encore collecté de partie contenant l'icône des joueurs. Les parties collectées avant aujourd'hui ne la portent pas : la grille se
          remplira au fil de la collecte.
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <section className="card card-pad studio-head">
        <div>
          <h2 className="studio-stat-name">Icônes d'invocateur</h2>
          <p className="muted studio-help">Les plus portées parmi les {sample.toLocaleString("fr-FR")} joueurs des parties collectées par NEX.</p>
        </div>
      </section>
      <section className="card card-pad icon-grid" aria-label="Icônes d'invocateur les plus portées">
        {list.map((i) => (
          <figure key={i.iconId}>
            <RemoteImg src={profileIcon(version, i.iconId)} alt={`Icône ${i.iconId}`} fallback="" />
            <figcaption>
              <b className="num">{i.players.toLocaleString("fr-FR")}</b>
              <span className="num muted">{i.winRate === null ? `moins de ${minPlayers} porteurs` : `${pct(i.winRate)} de victoires`}</span>
            </figcaption>
          </figure>
        ))}
      </section>
    </>
  );
}

function StatHeader({
  stat,
  rows,
  baseline,
  baselineSample,
}: {
  stat: StudioStat;
  rows: ReturnType<typeof toStudioRows>;
  baseline: { median: number | null; games: number } | null;
  baselineSample: number;
}) {
  const mine = stat.aggregate(rows);
  const wins = stat.aggregate(rows.filter((r) => r.win));
  const losses = stat.aggregate(rows.filter((r) => !r.win));
  const med = baseline?.median ?? null;
  const delta = mine !== null && med !== null ? mine - med : null;
  const good = delta === null ? null : delta === 0 ? null : delta > 0 === stat.higherIsBetter;

  return (
    <section className="card card-pad studio-head">
      <div>
        <h2 className="studio-stat-name">{stat.label}</h2>
        <p className="muted studio-help">{stat.help}</p>
      </div>
      <div className="studio-figures">
        <div className="studio-figure">
          <span className="muted">Ta valeur</span>
          <b className="num">{mine === null ? "—" : stat.format(mine)}</b>
          <span className="muted num">
            {rows.length} partie{rows.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="studio-figure">
          <span className="muted">En victoire</span>
          <b className="num win">{wins === null ? "—" : stat.format(wins)}</b>
        </div>
        <div className="studio-figure">
          <span className="muted">En défaite</span>
          <b className="num loss">{losses === null ? "—" : stat.format(losses)}</b>
        </div>
        <div className="studio-figure">
          <span className="muted">Médiane collectée</span>
          <b className="num">{med === null ? "—" : stat.format(med)}</b>
          <span className="muted num">
            {med === null
              ? baselineSample === 0
                ? "aucune partie collectée"
                : "pas encore mesurée"
              : `${baseline?.games.toLocaleString("fr-FR")} joueurs`}
          </span>
        </div>
        {delta !== null && (
          <div className="studio-figure">
            <span className="muted">Écart</span>
            <b className={`num ${good === null ? "" : good ? "pos" : "neg"}`}>
              {delta < 0 ? "−" : "+"}
              {(stat.formatDelta ?? stat.format)(Math.abs(delta))}
            </b>
          </div>
        )}
      </div>
    </section>
  );
}

function ChampionTable({ stat, rows }: { stat: StudioStat; rows: ReturnType<typeof toStudioRows> }) {
  const version = useDDragonVersion();
  const list = useMemo(() => byChampion(rows, stat), [rows, stat]);
  if (!list.length) {
    return (
      <div className="card">
        <EmptyState title="Mesure non disponible">
          Aucune de tes parties retenues ne porte cette donnée. Riot ne la fournit pas sur toutes les parties, et les parties lues dans le client League en
          portent moins.
        </EmptyState>
      </div>
    );
  }
  const max = Math.max(...list.map((c) => Math.abs(c.value as number)), 1);

  return (
    <section className="card studio-table-card" aria-label={`Tes champions classés par ${stat.label}`}>
      <table className="studio-table">
        <thead>
          <tr>
            <th scope="col" className="num">
              #
            </th>
            <th scope="col">Champion</th>
            <th scope="col" className="num">
              {stat.label}
            </th>
            <th scope="col" className="studio-bar-col" />
            <th scope="col" className="num">
              En victoire
            </th>
            <th scope="col" className="num">
              En défaite
            </th>
            <th scope="col" className="num">
              Parties
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((c, i) => (
            <tr key={c.champion}>
              <td className="num muted">{i + 1}</td>
              <td>
                <span className="studio-champ">
                  <ChampIcon version={version} champion={c.champion} size={24} rounded={6} />
                  {championName(c.champion)}
                </span>
              </td>
              <td className="num">
                <b>{stat.format(c.value as number)}</b>
              </td>
              <td className="studio-bar-col">
                <span className="studio-bar">
                  <i style={{ width: `${(Math.abs(c.value as number) / max) * 100}%` }} />
                </span>
              </td>
              <td className="num win">{c.inWins === null ? "—" : stat.format(c.inWins)}</td>
              <td className="num loss">{c.inLosses === null ? "—" : stat.format(c.inLosses)}</td>
              <td className="num muted">
                {c.games} · {pct(c.games ? c.wins / c.games : null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
