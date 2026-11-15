// Tableau complet des champions joues, derriere « Voir tous les champions » de la carte
// laterale du profil.
//
// PERIMETRE : les parties DEJA CHARGEES par la page, pas la saison. Le profil pagine par
// vingt (`count` est borne a 20 cote backend) et n'en charge d'avantage que si on le lui
// demande. Afficher « la saison » sans l'avoir lue serait un mensonge : l'en-tete annonce
// donc l'echantillon reel, et renvoie au bouton « Charger plus » de l'historique.
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { championName } from "../../data/assets";
import type { ChampionAggregate } from "../../domain/metrics";
import { kdaOf } from "../../domain/metrics";
import { ChampIcon } from "../../ui/primitives";
import { pct } from "../../ui/format";

type Colonne =
  | "rang"
  | "nom"
  | "victoires"
  | "kda"
  | "lp"
  | "maxKills"
  | "maxDeaths"
  | "cs"
  | "degats"
  | "or"
  | "doubles"
  | "triples"
  | "quadras"
  | "pentas";

const entier = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function ChampionSeasonTable({
  champions,
  version,
  parties,
  periode,
  onClose,
}: {
  champions: ChampionAggregate[];
  version: string | null;
  /** Nombre de parties comptees dans ces agregats. */
  parties: number;
  /** Periode couverte par ces parties, telle que la page l'a calculee. */
  periode: string;
  onClose: () => void;
}) {
  const [tri, setTri] = useState<{ col: Colonne; desc: boolean }>({ col: "rang", desc: false });

  /** Rang de reference : par nombre de parties, l'ordre dans lequel les agregats arrivent. */
  const rangs = useMemo(() => new Map(champions.map((c, i) => [c.champion, i + 1])), [champions]);

  const triees = useMemo(() => {
    const valeur = (c: ChampionAggregate): number | string => {
      switch (tri.col) {
        case "rang":
          return rangs.get(c.champion) ?? 9999;
        case "nom":
          return championName(c.champion);
        case "victoires":
          return c.games ? c.wins / c.games : 0;
        case "kda":
          return kdaOf(c.kills, c.deaths, c.assists);
        // Les LP non observes ne valent pas zero : ils se rangent en bas dans les deux sens,
        // pour ne jamais se faire passer pour un resultat neutre.
        case "lp":
          return c.lpDelta ?? Number.NEGATIVE_INFINITY;
        case "maxKills":
          return c.maxKills;
        case "maxDeaths":
          return c.maxDeaths;
        case "cs":
          return c.games ? c.cs / c.games : 0;
        case "degats":
          return c.games ? c.damage / c.games : 0;
        case "or":
          return c.games ? c.gold / c.games : 0;
        case "doubles":
          return c.doubles;
        case "triples":
          return c.triples;
        case "quadras":
          return c.quadras;
        case "pentas":
          return c.pentas;
      }
    };
    return [...champions].sort((a, b) => {
      const x = valeur(a);
      const y = valeur(b);
      const r = typeof x === "string" ? x.localeCompare(y as string, "fr") : (x as number) - (y as number);
      return tri.desc ? -r : r;
    });
  }, [champions, tri, rangs]);

  const Th = ({ col, children, titre }: { col: Colonne; children: React.ReactNode; titre?: string }) => (
    <th scope="col" title={titre} aria-sort={tri.col === col ? (tri.desc ? "descending" : "ascending") : "none"}>
      <button
        className="th-sort"
        onClick={() => setTri((t) => ({ col, desc: t.col === col ? !t.desc : col !== "nom" && col !== "rang" }))}
      >
        {children}
        {tri.col === col && (tri.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
      </button>
    </th>
  );

  /** Un tiret plutot qu'un zero : rien n'a ete observe, ce n'est pas un resultat nul. */
  const serie = (n: number) => (n > 0 ? entier.format(n) : <span className="muted">—</span>);

  return (
    <section className="champ-saison">
      <div className="page-head">
        <button className="btn btn-sm" onClick={onClose}>
          <ArrowLeft size={14} /> Retour au profil
        </button>
        <h2 className="page-title" style={{ margin: 0 }}>
          Tous les champions joués
        </h2>
        <div className="spacer" />
        <span className="muted num">
          {champions.length} champion{champions.length > 1 ? "s" : ""} · {parties} partie{parties > 1 ? "s" : ""} ({periode})
        </span>
      </div>

      <div className="card table-card">
        <table className="data-table">
          <thead>
            <tr>
              <Th col="rang">#</Th>
              <Th col="nom">Champion</Th>
              <Th col="victoires">Victoires</Th>
              <Th col="kda" titre="Moyenne (éliminations + aides) / morts">KDA</Th>
              <Th col="lp" titre="Somme des variations de LP réellement observées">LP</Th>
              <Th col="maxKills">Max élim.</Th>
              <Th col="maxDeaths">Max morts</Th>
              <Th col="cs" titre="Sbires et monstres neutres, par partie">CS</Th>
              <Th col="degats" titre="Dégâts aux champions, par partie">Dégâts</Th>
              <Th col="or" titre="Or gagné, par partie">Or</Th>
              <Th col="doubles" titre="Parties comptant au moins un double">2×</Th>
              <Th col="triples" titre="Parties comptant au moins un triple">3×</Th>
              <Th col="quadras" titre="Parties comptant au moins un quadra">4×</Th>
              <Th col="pentas" titre="Parties comptant un penta">5×</Th>
            </tr>
          </thead>
          <tbody>
            {triees.map((c) => {
              const tauxVictoire = c.games ? c.wins / c.games : 0;
              return (
                <tr key={c.champion}>
                  <td className="num muted">{rangs.get(c.champion)}</td>
                  <th scope="row">
                    <span className="cell-champ">
                      <ChampIcon version={version} champion={c.champion} size={28} rounded={7} />
                      <span>{championName(c.champion)}</span>
                    </span>
                  </th>
                  <td className="num">
                    <b className={tauxVictoire >= 0.5 ? "win" : "loss"}>{pct(tauxVictoire)}</b>{" "}
                    <span className="muted">
                      {c.wins}V {c.games - c.wins}D
                    </span>
                  </td>
                  <td className="num">
                    <b>{kdaOf(c.kills, c.deaths, c.assists).toFixed(2)}</b>{" "}
                    <span className="muted">
                      {(c.kills / c.games).toFixed(1)} / {(c.deaths / c.games).toFixed(1)} / {(c.assists / c.games).toFixed(1)}
                    </span>
                  </td>
                  <td className="num">
                    {c.lpDelta === null ? (
                      <span className="muted" title="Aucune variation de LP observée sur ces parties">
                        —
                      </span>
                    ) : (
                      <span className={c.lpDelta > 0 ? "win" : c.lpDelta < 0 ? "loss" : "muted"}>
                        {c.lpDelta > 0 ? "+" : c.lpDelta < 0 ? "−" : ""}
                        {Math.abs(c.lpDelta)} LP
                      </span>
                    )}
                  </td>
                  <td className="num">{c.maxKills}</td>
                  <td className="num">{c.maxDeaths}</td>
                  <td className="num">{(c.cs / c.games).toFixed(1)}</td>
                  <td className="num">{entier.format(c.damage / c.games)}</td>
                  <td className="num">{entier.format(c.gold / c.games)}</td>
                  <td className="num">{serie(c.doubles)}</td>
                  <td className="num">{serie(c.triples)}</td>
                  <td className="num">{serie(c.quadras)}</td>
                  <td className="num">{serie(c.pentas)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="champ-note muted">
        Calculé sur les <b>{parties} parties chargées</b> par cette page, et non sur la saison entière : le profil lit
        l'historique par pages de vingt. Charge plus de parties depuis l'historique pour élargir ces moyennes.{" "}
        Les colonnes 2× à 5× comptent les <b>parties</b> où une série a été réussie, pas les séries : Riot ne publie que la
        plus longue de chaque partie, donc une partie avec un penta n'ajoute rien aux doubles. Les LP sont ceux que NEX a
        relevés lui-même entre deux parties classées ; « — » signifie non observé, pas zéro.
      </p>
    </section>
  );
}
