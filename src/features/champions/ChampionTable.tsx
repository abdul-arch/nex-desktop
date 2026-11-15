// Classement des champions : un tableau dense, groupe par tier, trie par colonne.
//
// Les chiffres viennent de `/v1/stats/tierlist`, donc des parties que NEX a lui-meme
// collectees — jamais d'un site tiers. Trois consequences assumees, visibles dans
// l'interface plutot que cachees :
//
//  - Le collecteur ne recolte que Master, Grand Maitre et Challenger : le selecteur de rang
//    n'offre que ceux-la. Proposer Fer ou Or afficherait des colonnes vides.
//  - L'echantillon se compte en milliers de parties, pas en millions. Chaque ligne porte
//    son nombre de parties, et l'en-tete rappelle la taille du lot.
//  - Sous le seuil de parties du backend, le tier vaut « ? » : il n'est pas devine.
//
// Le tier lui-meme est calcule cote backend : retrait bayesien vers 50 % (K = 40), puis
// des seuils fixes — S+ a 53,5 %, S a 52 %, A a 50,5 %, B a 49 %, C a 47,5 %.
import { Info, RotateCcw, Search, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppState, useDDragonVersion } from "../../app/AppState";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import type { ChampionStatDto, TierListDto } from "../../platform/api";
import { platform } from "../../platform";
import { ErrorPanel } from "../../ui/ErrorPanel";
import { ChampIcon, EmptyState, PositionIcon } from "../../ui/primitives";
import { paramsKey, RoleFilter, StatsFilters, TierBadge, TIER_NAMES, toParams, useChampionList, useStatsFilters, useStatsMeta } from "../stats/statsShared";

/** Ordre d'affichage des groupes. `?` ferme la marche : echantillon insuffisant. */
const TIERS = ["S+", "S", "A", "B", "C", "D", "?"];

/** Colonnes triables. `defaut` indique le sens au premier clic. */
type Colonne = "rang" | "nom" | "tier" | "victoire" | "pick" | "ban" | "parties";

/** Seuil de selection par defaut, en fraction. Repris de la maquette de reference. */
const SEUIL_DEFAUT = 0.005;

/** Parties minimales sur le patch precedent pour qu'une tendance veuille dire quelque chose. */
const MIN_PARTIES_TENDANCE = 200;

const CLE_RECENTS = "nex.champions.recents";

/** Champions consultes recemment. Rangement local au poste : une preference d'affichage
 *  n'a pas a voyager, et le stockage peut etre refuse sans que la page en souffre. */
function useRecents(): [number[], (id: number) => void] {
  const [ids, setIds] = useState<number[]>(() => {
    try {
      const brut = localStorage.getItem(CLE_RECENTS);
      const lu: unknown = brut ? JSON.parse(brut) : [];
      return Array.isArray(lu) ? lu.filter((x): x is number => typeof x === "number").slice(0, 8) : [];
    } catch {
      return [];
    }
  });
  const pousser = (id: number) => {
    setIds((avant) => {
      const suite = [id, ...avant.filter((x) => x !== id)].slice(0, 8);
      try {
        localStorage.setItem(CLE_RECENTS, JSON.stringify(suite));
      } catch {
        // Stockage refuse (navigation privee, donnees bloquees) : la liste vit en memoire.
      }
      return suite;
    });
  };
  return [ids, pousser];
}

/** Texte comparable : sans accent ni casse, pour que « Cho'Gath » reponde a « chogath ». */
function pliage(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

const pourcent = (v: number, decimales = 0) => `${(v * 100).toFixed(decimales)} %`;

/** Nombre de parties en forme courte : 31,1 k se lit mieux que 31 100 dans une colonne. */
function parties(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(".", ",")} k`;
}

export function ChampionTable() {
  const version = useDDragonVersion();
  const { navigate } = useNav();
  const { settings, setSetting } = useAppState();
  const liste = useChampionList();
  const meta = useStatsMeta();
  const [filtres] = useStatsFilters();
  const [recents, pousserRecent] = useRecents();

  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [seuilActif, setSeuilActif] = useState(true);
  const [seuil, setSeuil] = useState(SEUIL_DEFAUT);
  const [grouper, setGrouper] = useState(true);
  // Reprend ce que faisait la page « Builds & tier lists », fondue ici : une ligne par
  // champion ET par poste, pour comparer un champion a lui-meme d'une voie a l'autre.
  const [parPoste, setParPoste] = useState(false);
  const [masquerPetits, setMasquerPetits] = useState(false);
  const [tri, setTri] = useState<{ col: Colonne; desc: boolean }>({ col: "rang", desc: false });
  const [favsSeuls, setFavsSeuls] = useState(false);

  const favs = settings.favoriteChampions ?? [];
  const basculerFav = (id: number) => setSetting("favoriteChampions", favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]);

  // Le role part au backend : c'est lui qui recalcule le classement pour ce poste, au lieu
  // de filtrer un classement « tous postes » qui ne voudrait plus rien dire.
  const params = toParams(filtres, role || null);
  const tl = useAsync<TierListDto>(`tierlist:${paramsKey(params)}`, () => platform.statsTierList(params), 60_000);

  // Patch precedent, pour la tendance. Charge seulement s'il porte assez de parties.
  const patchs = meta.data?.patches ?? [];
  const actuel = filtres.patch || patchs[0]?.[0];
  const indexActuel = patchs.findIndex(([p]) => p === actuel);
  const precedent = indexActuel >= 0 ? patchs[indexActuel + 1] : undefined;
  const precedentUtile = precedent && precedent[1] >= MIN_PARTIES_TENDANCE ? precedent[0] : null;
  const paramsPrec = toParams({ ...filtres, patch: precedentUtile ?? "" }, role || null);
  const tlPrec = useAsync<TierListDto>(
    precedentUtile ? `tierlist:${paramsKey(paramsPrec)}` : null,
    () => platform.statsTierList(paramsPrec),
    60_000,
  );

  const nomsParId = useMemo(() => new Map(liste.map((c) => [c.id, c])), [liste]);
  /** Echantillon minimal pour qu'un champion soit classe, annonce par le backend. */
  const min = meta.data?.minGames ?? 20;

  /** Identite d'une ligne : le champion seul, ou le couple champion+poste. Sert de cle de
   *  rendu, de classement et de tendance — les trois doivent s'accorder. Nommee `cleLigne`
   *  et non `cle` : `triees` declare deja un `cle` local qui la masquerait. */
  const cleLigne = useCallback((c: ChampionStatDto) => (parPoste ? `${c.championId}-${c.position}` : String(c.championId)), [parPoste]);

  /** Une ligne par champion, a son poste le plus joue : un champion ne doit pas occuper
   *  cinq lignes du classement. En mode « par poste », on garde au contraire chaque couple
   *  champion+poste tel que le backend le renvoie. */
  const lignes = useMemo(() => {
    const toutes = tl.data?.champions ?? [];
    if (parPoste) return [...toutes];
    const parChampion = new Map<number, ChampionStatDto>();
    for (const c of toutes) {
      const dejala = parChampion.get(c.championId);
      if (!dejala || c.games > dejala.games) parChampion.set(c.championId, c);
    }
    return [...parChampion.values()];
  }, [tl.data, parPoste]);

  /** Rang de chaque champion sur le patch precedent, pour la tendance. */
  const rangPrecedent = useMemo(() => {
    if (!tlPrec.data) return null;
    const parChampion = new Map<string, ChampionStatDto>();
    for (const c of tlPrec.data.champions) {
      const d = parChampion.get(cleLigne(c));
      if (!d || c.games > d.games) parChampion.set(cleLigne(c), c);
    }
    const classe = [...parChampion.values()].sort((a, b) => b.adjustedWinRate - a.adjustedWinRate);
    return new Map(classe.map((c, i) => [cleLigne(c), i + 1]));
  }, [tlPrec.data, cleLigne]);

  // Classement de reference : c'est lui qui donne la colonne « # », avant tout filtrage.
  const classement = useMemo(() => {
    const ordonne = [...lignes].sort((a, b) => b.adjustedWinRate - a.adjustedWinRate || b.games - a.games);
    return new Map(ordonne.map((c, i) => [cleLigne(c), i + 1]));
  }, [lignes, cleLigne]);

  const filtrees = useMemo(() => {
    const recherche = pliage(q);
    return lignes.filter((c) => {
      if (masquerPetits && c.games < min) return false;
      if (seuilActif && c.pickRate < seuil) return false;
      if (favsSeuls && !favs.includes(c.championId)) return false;
      if (recherche) {
        const nom = nomsParId.get(c.championId)?.name ?? "";
        if (!pliage(nom).includes(recherche)) return false;
      }
      return true;
    });
  }, [lignes, seuilActif, seuil, favsSeuls, favs, q, nomsParId, masquerPetits, min]);

  /** Combien de champions le seuil retire a lui seul. La colonne « # » garde le rang
   *  d'ensemble, donc elle saute des numeros : autant dire lesquels manquent et pourquoi. */
  const masquesParSeuil = useMemo(
    () => (seuilActif ? lignes.filter((c) => c.pickRate < seuil).length : 0),
    [lignes, seuilActif, seuil],
  );

  const triees = useMemo(() => {
    const nom = (c: ChampionStatDto) => nomsParId.get(c.championId)?.name ?? "";
    const rangTier = (c: ChampionStatDto) => {
      const i = TIERS.indexOf(c.tier);
      return i < 0 ? TIERS.length : i;
    };
    const cle: Record<Colonne, (c: ChampionStatDto) => number | string> = {
      rang: (c) => classement.get(cleLigne(c)) ?? 9999,
      nom,
      tier: rangTier,
      victoire: (c) => c.adjustedWinRate,
      pick: (c) => c.pickRate,
      ban: (c) => c.banRate,
      parties: (c) => c.games,
    };
    const f = cle[tri.col];
    const out = [...filtrees].sort((a, b) => {
      const va = f(a);
      const vb = f(b);
      const cmp = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb, "fr") : Number(va) - Number(vb);
      return tri.desc ? -cmp : cmp;
    });
    return out;
  }, [filtrees, tri, classement, nomsParId, cleLigne]);

  /** Groupes dans l'ordre des tiers, vides retires. */
  const groupes = useMemo(() => {
    if (!grouper) return [{ tier: null as string | null, rows: triees }];
    return TIERS.map((t) => ({ tier: t, rows: triees.filter((c) => c.tier === t) })).filter((g) => g.rows.length > 0);
  }, [triees, grouper]);

  const trierPar = (col: Colonne) =>
    setTri((t) => (t.col === col ? { col, desc: !t.desc } : { col, desc: col !== "nom" && col !== "rang" && col !== "tier" }));

  const reinitialiser = () => {
    setRole("");
    setQ("");
    setParPoste(false);
    setMasquerPetits(false);
    setSeuilActif(true);
    setSeuil(SEUIL_DEFAUT);
    setGrouper(true);
    setFavsSeuls(false);
    setTri({ col: "rang", desc: false });
  };

  const ouvrir = (id: number, cle: string) => {
    pousserRecent(id);
    navigate("champions", { champion: cle, ...(role ? { role } : {}) });
  };

  const scope = tl.data?.scope;
  /** Mediane des parties par champion : de quoi calibrer la confiance a donner au
   *  classement. A quelques dizaines de parties, l'ordre tient surtout au hasard. */
  const medianeParties = useMemo(() => {
    if (triees.length === 0) return null;
    const n = [...triees].map((c) => c.games).sort((a, b) => a - b);
    return n[Math.floor(n.length / 2)];
  }, [triees]);
  const enTete = (col: Colonne, libelle: string, aide?: string) => (
    <th scope="col" className={`tri ${tri.col === col ? "actif" : ""}`} aria-sort={tri.col === col ? (tri.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => trierPar(col)} title={aide}>
        {libelle}
        <span aria-hidden="true">{tri.col === col ? (tri.desc ? " ↓" : " ↑") : ""}</span>
      </button>
    </th>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Champions</h1>
        {recents.length > 0 && (
          <div className="champ-recents" aria-label="Champions consultés récemment">
            <span className="muted">Récents</span>
            {recents.map((id) => {
              const c = nomsParId.get(id);
              return c ? (
                <button key={id} type="button" onClick={() => ouvrir(c.id, c.key)} title={c.name} aria-label={`Ouvrir ${c.name}`}>
                  <ChampIcon version={version} champion={c.key} size={26} rounded={7} />
                </button>
              ) : null;
            })}
          </div>
        )}
        <div className="spacer" />
        <StatsFilters meta={meta.data} />
      </div>

      <div className="champ-toolbar">
        <RoleFilter value={role} onChange={setRole} />
        <label className="search-box">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher des champions" aria-label="Rechercher des champions" />
        </label>

        <label className="champ-switch">
          <input type="checkbox" checked={seuilActif} onChange={(e) => setSeuilActif(e.target.checked)} />
          <span>
            Taux de sélection ≥{" "}
            <input
              className="seuil"
              type="number"
              min={0}
              max={20}
              step={0.1}
              value={(seuil * 100).toFixed(1)}
              onChange={(e) => setSeuil(Math.max(0, Number(e.target.value) || 0) / 100)}
              aria-label="Seuil de taux de sélection, en pourcent"
              disabled={!seuilActif}
            />{" "}
            %
          </span>
        </label>

        <label className="champ-switch">
          <input type="checkbox" checked={grouper} onChange={(e) => setGrouper(e.target.checked)} />
          <span>Regrouper par tier</span>
        </label>

        <label className="champ-switch" title="Un champion joué sérieusement à deux postes occupe alors deux lignes">
          <input type="checkbox" checked={parPoste} onChange={(e) => setParPoste(e.target.checked)} />
          <span>Détailler par poste</span>
        </label>

        <label className="champ-switch">
          <input type="checkbox" checked={masquerPetits} onChange={(e) => setMasquerPetits(e.target.checked)} />
          <span>Masquer sous {min} parties</span>
        </label>

        <button className="btn btn-sm" aria-pressed={favsSeuls} onClick={() => setFavsSeuls((v) => !v)}>
          <Star size={13} fill={favsSeuls ? "currentColor" : "none"} style={favsSeuls ? { color: "var(--gold)" } : undefined} /> Favoris
        </button>

        <button className="btn btn-sm" onClick={reinitialiser} title="Remettre les filtres de cette page à zéro">
          <RotateCcw size={13} /> Réinitialiser
        </button>
      </div>

      {tl.error != null && <ErrorPanel error={tl.error} onRetry={() => tl.reload()} compact />}

      <section className="card tier-table-card">
        <div className="tier-table-head">
          <span className="num">
            <b>{triees.length}</b> champion{triees.length > 1 ? "s" : ""}
          </span>
          {scope && (
            <span className="muted num">
              patch {scope.patch} · {TIER_NAMES[scope.tier] ?? scope.tier} · {parties(scope.matches)} parties collectées par NEX
            </span>
          )}
          <span className="spacer" />
          {seuilActif && (
            <span className="muted">
              sélection ≥ {(seuil * 100).toFixed(1).replace(".", ",")} %
              {masquesParSeuil > 0 && ` · ${masquesParSeuil} masqué${masquesParSeuil > 1 ? "s" : ""}`}
            </span>
          )}
        </div>

        {tl.loading && !tl.data ? (
          <div className="muted" style={{ padding: 16 }}>Lecture des parties collectées…</div>
        ) : triees.length === 0 ? (
          <EmptyState title={lignes.length === 0 ? "Aucune statistique sur ce périmètre" : "Aucun champion ne passe ces filtres"}>
            {lignes.length === 0
              ? "Le collecteur n'a pas encore assez de parties pour ce patch, ce rang ou ce poste."
              : "Baisse le seuil de sélection, change de poste, ou réinitialise les filtres."}
          </EmptyState>
        ) : (
          <div className="tier-table-scroll">
            <table className="tier-table">
              <thead>
                <tr>
                  {enTete("rang", "#", "Rang sur l'ensemble du périmètre, taux de victoire ajusté décroissant. Un numéro absent est un champion écarté par les filtres.")}
                  {enTete("nom", "Champion")}
                  {enTete("tier", "Tier", "Retrait bayésien vers 50 % (K = 40), puis seuils fixes")}
                  {enTete("victoire", "Taux de victoire", "Taux ajusté : les petits échantillons sont ramenés vers 50 %")}
                  <th scope="col" title="Écart du taux ajusté à 50 %, en points">Écart</th>
                  {enTete("pick", "Pick")}
                  {enTete("ban", "Ban")}
                  {enTete("parties", "Parties")}
                  <th scope="col" title="Places gagnées ou perdues depuis le patch précédent">Tendance</th>
                </tr>
              </thead>
              {groupes.map((g) => (
                <tbody key={g.tier ?? "tout"}>
                  {g.tier && (
                    <tr className="champ-group">
                      <th scope="colgroup" colSpan={9}>
                        <TierBadge tier={g.tier} />
                        <span className="muted">
                          {g.rows.length} champion{g.rows.length > 1 ? "s" : ""}
                        </span>
                      </th>
                    </tr>
                  )}
                  {g.rows.map((c) => {
                    const champ = nomsParId.get(c.championId);
                    const brut = c.games > 0 ? c.wins / c.games : 0;
                    const ecart = (c.adjustedWinRate - 0.5) * 100;
                    const avant = rangPrecedent?.get(cleLigne(c));
                    const maintenant = classement.get(cleLigne(c));
                    const tendance = avant && maintenant ? avant - maintenant : null;
                    return (
                      <tr key={cleLigne(c)} className="champ-row" onClick={() => champ && ouvrir(c.championId, champ.key)}>
                        <td className="num rang">{classement.get(cleLigne(c))}</td>
                        <th scope="row" className="champ-cell">
                          {champ && <ChampIcon version={version} champion={champ.key} size={28} rounded={7} />}
                          <span className="champ-nom">{champ?.name ?? `#${c.championId}`}</span>
                          <PositionIcon position={c.position} size={13} />
                          <button
                            type="button"
                            className={`fav-btn ${favs.includes(c.championId) ? "on" : ""}`}
                            aria-pressed={favs.includes(c.championId)}
                            aria-label={favs.includes(c.championId) ? `Retirer ${champ?.name} des favoris` : `Ajouter ${champ?.name} aux favoris`}
                            onClick={(e) => {
                              // La ligne entiere ouvre le champion : l'etoile ne doit pas le faire.
                              e.stopPropagation();
                              basculerFav(c.championId);
                            }}
                          >
                            <Star size={12} fill={favs.includes(c.championId) ? "currentColor" : "none"} />
                          </button>
                        </th>
                        <td>
                          <TierBadge tier={c.tier} />
                        </td>
                        <td className="num" title={`Taux brut : ${pourcent(brut, 1)} sur ${c.games} parties`}>
                          <b>{pourcent(c.adjustedWinRate, 1)}</b>
                        </td>
                        <td className={`num ecart ${ecart > 0 ? "pos" : ecart < 0 ? "neg" : ""}`}>
                          {ecart > 0 ? "+" : ecart < 0 ? "−" : ""}
                          {Math.abs(ecart).toFixed(1).replace(".", ",")}
                        </td>
                        <td className="num">{pourcent(c.pickRate, 1)}</td>
                        <td className="num">{pourcent(c.banRate, 1)}</td>
                        <td className="num muted">{parties(c.games)}</td>
                        <td className={`num tendance ${tendance && tendance > 0 ? "pos" : tendance && tendance < 0 ? "neg" : "muted"}`}>
                          {tendance === null ? "—" : tendance === 0 ? "0" : `${tendance > 0 ? "+" : "−"}${Math.abs(tendance)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}

        <p className="champ-note muted">
          Chiffres calculés sur les parties que NEX a lui-même collectées, jamais importés d'un autre site. Chaque rang se
          remplit à mesure que le collecteur le parcourt : un rang ouvert depuis peu peut rester vide.
          {medianeParties !== null && (
            <>
              {" "}
              <b>Médiane de {medianeParties} parties par champion</b> sur ce périmètre : à cette taille, l'ordre du haut de
              tableau tient encore largement au hasard. Lis la colonne « Parties » avant le tier.
            </>
          )}
          {precedentUtile === null && " La tendance demande un patch précédent d'au moins 200 parties : elle reste vide tant que le lot est trop mince."}
        </p>
      </section>

      {/* Venu de la page « Builds & tier lists », fondue ici : le calcul etait explique la-bas,
          il doit l'etre a cote du tableau qu'il produit. */}
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
          Sans « Détailler par poste », un champion n'occupe qu'une ligne, celle de son poste le plus joué : les colonnes décrivent alors ce poste-là,
          pas la somme de tous. Coche la case pour voir chaque poste séparément.
        </p>
        <p>
          Source : parties collectées par le backend NEX. Le filtre « Rang » porte sur le rang du joueur dont la partie a été collectée.
          Ces statistiques décrivent des corrélations observées. Ce ne sont pas des recommandations garanties.
        </p>
      </details>
    </div>
  );
}

/** Enregistre un champion comme consulte, depuis la vue de detail. */
export function useMarquerConsulte(id: number | null) {
  const [, pousser] = useRecents();
  useEffect(() => {
    if (id !== null) pousser(id);
    // On ne veut qu'un enregistrement par champion ouvert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}
