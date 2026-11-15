// Accueil du site : la recherche en vedette, puis des cartes de vraies donnees.
//
// Le dessin suit dpm.lol et invade.lol — « Find a player », meilleurs picks par poste,
// classement, bans — mais chaque chiffre vient du backend NEX ou de l'API Riot. Quand une
// source manque, la carte le dit ; elle n'affiche jamais un exemple.
import { ArrowRight, Ban, Download, Search, Trophy, TrendingUp } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useAppState, useDDragonVersion } from "../app/AppState";
import { useNav } from "../app/navigation";
import { useAsync } from "../app/useAsync";
import { PLATFORMS, parseRiotId, platformLabel } from "../domain/riotId";
import { platform } from "../platform";
import type { ChampionStatDto, LeaderboardDto, TierListDto } from "../platform/api";
import { paramsKey, TierBadge, toParams, useChampionList, useStatsFilters, useStatsMeta } from "../features/stats/statsShared";
import { pct, ROLE_LABEL } from "../ui/format";
import { ChampIcon, PositionIcon } from "../ui/primitives";

/** L'application de bureau est publique : c'est la que vivent l'overlay et le draft. */
export const DEPOT_APP = "https://github.com/abdul-arch/nex-desktop";

const POSTES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
/** Plateforme et file du classement de l'accueil : le sommet de la ladder EUW. */
const CLASSEMENT = { platform: "EUW1", queue: "RANKED_SOLO_5x5", tier: "CHALLENGER" };

export function Accueil({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="accueil">
      <Recherche onSearch={onSearch} />
      <div className="accueil-sections">
        <MeilleursPicks />
        <Classement />
        <PlusBannis />
        <CarteApp />
      </div>
    </div>
  );
}

/* ---------- recherche ---------- */

function Recherche({ onSearch }: { onSearch: () => void }) {
  const { settings } = useAppState();
  const { navigate } = useNav();
  const [saisie, setSaisie] = useState("");
  const [plat, setPlat] = useState(settings.defaultPlatform || "EUW1");
  const [erreur, setErreur] = useState<string | null>(null);

  const chercher = (e: FormEvent) => {
    e.preventDefault();
    const r = parseRiotId(saisie);
    if (!r.ok) {
      setErreur(r.error);
      return;
    }
    setErreur(null);
    navigate("profile", { riotId: `${r.value.gameName}#${r.value.tagLine}`, platform: plat });
  };

  return (
    <section className="accueil-hero">
      <h1>Trouve un joueur</h1>
      <p>Rang, historique, champions et courbe de LP — les tiens ou ceux de n'importe qui, sur les données de l'API Riot.</p>
      <form className="accueil-form" onSubmit={chercher} role="search">
        <select value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Région">
          {PLATFORMS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder="Pseudo#TAG"
          aria-label="Riot ID, sous la forme Pseudo#TAG"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit">
          <Search size={15} aria-hidden="true" /> Rechercher
        </button>
      </form>
      <div className="accueil-erreur" role="alert">
        {erreur ?? ""}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onSearch}>
        Ou cherche un champion, une équipe pro — <kbd>Ctrl</kbd>+<kbd>K</kbd>
      </button>
    </section>
  );
}

/* ---------- donnees communes aux cartes de tier list ---------- */

function useTierList() {
  const meta = useStatsMeta();
  const [filtres] = useStatsFilters();
  const params = toParams(filtres, null);
  const tl = useAsync<TierListDto>(`tierlist:${paramsKey(params)}`, () => platform.statsTierList(params), 60_000);
  return { tl, min: meta.data?.minGames ?? 20 };
}

function Bloc({ titre, icone, lien, children }: { titre: React.ReactNode; icone: React.ReactNode; lien?: { label: string; onClick: () => void; href: string }; children: React.ReactNode }) {
  return (
    <section className="accueil-bloc">
      <header>
        <h2>
          {icone} {titre}
        </h2>
        {lien && (
          <a
            href={lien.href}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault();
              lien.onClick();
            }}
          >
            {lien.label} <ArrowRight size={13} aria-hidden="true" />
          </a>
        )}
      </header>
      {children}
    </section>
  );
}

function Etat({ chargement, erreur, vide }: { chargement: boolean; erreur: unknown; vide: boolean }) {
  if (chargement) return <p className="accueil-etat muted">Chargement…</p>;
  if (erreur != null) return <p className="accueil-etat muted">Statistiques indisponibles pour l'instant.</p>;
  if (vide) return <p className="accueil-etat muted">Pas encore assez de parties collectées.</p>;
  return null;
}

/* ---------- meilleurs picks par poste ---------- */

function MeilleursPicks() {
  const { tl, min } = useTierList();
  const liste = useChampionList();
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const nomsParId = useMemo(() => new Map(liste.map((c) => [c.id, c])), [liste]);

  // Par poste, le champion au meilleur taux ajuste parmi ceux qui ont assez de parties :
  // la meme regle que la tier list, pas un classement a part.
  const picks = useMemo(() => {
    const parPoste = new Map<string, ChampionStatDto>();
    for (const c of tl.data?.champions ?? []) {
      if (c.games < min) continue;
      const d = parPoste.get(c.position);
      if (!d || c.adjustedWinRate > d.adjustedWinRate) parPoste.set(c.position, c);
    }
    return POSTES.map((p) => [p, parPoste.get(p)] as const).filter((x): x is readonly [(typeof POSTES)[number], ChampionStatDto] => !!x[1]);
  }, [tl.data, min]);
  const patch = tl.data?.scope.patch;

  return (
    <Bloc
      titre={
        <>
          Meilleurs picks {patch && <span className="muted">patch {patch}</span>}
        </>
      }
      icone={<TrendingUp size={16} aria-hidden="true" />}
      lien={{ label: "Tier list", href: "/champions", onClick: () => navigate("champions") }}
    >
      <Etat chargement={tl.loading && !tl.data} erreur={tl.error} vide={!!tl.data && picks.length === 0} />
      <ul className="accueil-lignes">
        {picks.map(([poste, c]) => {
          const champ = nomsParId.get(c.championId);
          return (
            <li key={poste}>
              <button type="button" onClick={() => champ && navigate("champions", { champion: champ.key, role: poste })}>
                <span className="accueil-poste">
                  <PositionIcon position={poste} size={14} /> {ROLE_LABEL[poste]}
                </span>
                <span className="accueil-champ">
                  {champ && <ChampIcon version={version} champion={champ.key} size={30} rounded={8} />}
                  <b>{champ?.name ?? `#${c.championId}`}</b>
                </span>
                <TierBadge tier={c.tier} />
                <span className="num accueil-taux">{pct(c.adjustedWinRate, 1)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Bloc>
  );
}

/* ---------- classement ---------- */

function Classement() {
  const { navigate } = useNav();
  const board = useAsync<LeaderboardDto>(
    `board:${CLASSEMENT.platform}:${CLASSEMENT.queue}:${CLASSEMENT.tier}:1`,
    () => platform.leaderboard(CLASSEMENT.platform, CLASSEMENT.queue, CLASSEMENT.tier, 1),
    120_000,
  );
  const tete = board.data?.entries.slice(0, 5) ?? [];

  return (
    <Bloc
      titre={
        <>
          Classement <span className="muted">Challenger · {platformLabel(CLASSEMENT.platform)}</span>
        </>
      }
      icone={<Trophy size={16} aria-hidden="true" />}
      lien={{ label: "Tout le classement", href: "/classements", onClick: () => navigate("leaderboards") }}
    >
      <Etat chargement={board.loading && !board.data} erreur={board.error} vide={!!board.data && tete.length === 0} />
      <ol className="accueil-lignes">
        {tete.map((j) => (
          <li key={j.puuid}>
            <button type="button" onClick={() => navigate("profile", { riotId: `${j.gameName}#${j.tagLine}`, platform: CLASSEMENT.platform })}>
              <span className="num accueil-rang">{j.rank}</span>
              <span className="accueil-champ">
                <b>{j.gameName}</b>
                <span className="muted">#{j.tagLine}</span>
              </span>
              <span className="num accueil-taux">{j.lp.toLocaleString("fr-FR")} LP</span>
            </button>
          </li>
        ))}
      </ol>
    </Bloc>
  );
}

/* ---------- les plus bannis ---------- */

function PlusBannis() {
  const { tl } = useTierList();
  const liste = useChampionList();
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const nomsParId = useMemo(() => new Map(liste.map((c) => [c.id, c])), [liste]);

  // Le taux de ban est compte tous postes confondus : une ligne par champion, pas par poste.
  const bans = useMemo(() => {
    const parChampion = new Map<number, ChampionStatDto>();
    for (const c of tl.data?.champions ?? []) {
      const d = parChampion.get(c.championId);
      if (!d || c.banRate > d.banRate) parChampion.set(c.championId, c);
    }
    return [...parChampion.values()].filter((c) => c.banRate > 0).sort((a, b) => b.banRate - a.banRate).slice(0, 5);
  }, [tl.data]);

  return (
    <Bloc titre="Les plus bannis" icone={<Ban size={16} aria-hidden="true" />} lien={{ label: "Tier list", href: "/champions", onClick: () => navigate("champions") }}>
      <Etat chargement={tl.loading && !tl.data} erreur={tl.error} vide={!!tl.data && bans.length === 0} />
      <ol className="accueil-lignes">
        {bans.map((c) => {
          const champ = nomsParId.get(c.championId);
          return (
            <li key={c.championId}>
              <button type="button" onClick={() => champ && navigate("champions", { champion: champ.key })}>
                <span className="accueil-champ">
                  {champ && <ChampIcon version={version} champion={champ.key} size={30} rounded={8} />}
                  <b>{champ?.name ?? `#${c.championId}`}</b>
                </span>
                <span className="num accueil-taux">
                  {pct(c.banRate, 1)} <span className="muted">des parties</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Bloc>
  );
}

/* ---------- l'application ---------- */

function CarteApp() {
  return (
    <a className="accueil-app" href={DEPOT_APP} target="_blank" rel="noreferrer">
      <b>
        <Download size={16} aria-hidden="true" /> NEX pour Windows
      </b>
      <span>Overlay en partie, assistant de draft, rappels de build et clips automatiques. Gratuit, code ouvert.</span>
      <em>Télécharger sur GitHub</em>
    </a>
  );
}
