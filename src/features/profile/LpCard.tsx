// Historique des LP d'un compte, trace a partir des releves enregistres par le backend.
//
// Riot ne sert que le rang courant : cette carte ne montre que ce que NEX a observe depuis
// le premier releve. Aucune reconstitution du passe, aucune interpolation entre deux releves.
import { useEffect, useRef, useState } from "react";
import { useAsync } from "../../app/useAsync";
import { ladderPoints, type LpChange, lpChanges, lpSeries } from "../../domain/lp";
import { platform } from "../../platform";
import type { RankSnapshotDto } from "../../platform/api";
import { PeakChart } from "../../ui/PeakChart";
import { TIER_LABEL } from "../../ui/format";
import { Segmented } from "../../ui/primitives";

type Q = "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";

const shortDate = (at: number) => new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const dateHeure = (at: number) =>
  new Date(at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const rankText = (s: RankSnapshotDto) => `${TIER_LABEL[s.tier] ?? s.tier}${s.division ? ` ${s.division}` : ""} · ${s.lp} LP`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

export function LpCard({ puuid, plat }: { puuid: string; plat: string }) {
  const [queue, setQueue] = useState<Q>("RANKED_SOLO_5x5");
  const snaps = useAsync<RankSnapshotDto[]>(`ranks:${plat}:${puuid}`, () => platform.rankHistory(plat, puuid), 60_000);
  const all = snaps.data ?? [];
  const changes = lpChanges(all, queue);
  const inQueue = all.filter((s) => s.queue === queue);
  const latest = [...inQueue].sort((a, b) => b.at - a.at)[0];
  // Meilleur rang jamais releve par NEX pour cette file. Pas « le record du compte » :
  // seulement le sommet de ce que l'application a vu passer, d'ou le libelle.
  const best = inQueue.reduce<RankSnapshotDto | null>((top, s) => {
    const a = ladderPoints(s.tier, s.division, s.lp);
    const b = top ? ladderPoints(top.tier, top.division, top.lp) : null;
    return a !== null && (b === null || a > b) ? s : top;
  }, null);

  return (
    <section className="card card-pad lp-card" aria-label="Historique des LP">
      <div className="card-title" style={{ justifyContent: "space-between" }}>
        Historique des LP
        <Segmented
          label="File classée"
          options={[
            { value: "RANKED_SOLO_5x5", label: "Solo/Duo" },
            { value: "RANKED_FLEX_SR", label: "Flex" },
          ]}
          value={queue}
          onChange={setQueue}
        />
      </div>
      {snaps.loading && !snaps.data ? (
        <p className="muted" style={{ margin: 0 }}>
          Chargement des relevés…
        </p>
      ) : changes.length === 0 ? (
        <Empty latest={latest} />
      ) : (
        <Chart changes={changes} latest={latest} best={best} />
      )}
    </section>
  );
}

function Empty({ latest }: { latest: RankSnapshotDto | undefined }) {
  return (
    <>
      {latest && <div className="lp-now num">{rankText(latest)}</div>}
      <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
        {latest
          ? "Un seul relevé pour l'instant : la courbe apparaîtra au premier changement de LP."
          : "Pas encore de relevé pour cette file."}{" "}
        Riot ne fournit que le rang courant, jamais le passé : NEX enregistre le rang à chaque fois qu'il lit ce profil, et l'historique part de là.
      </p>
    </>
  );
}

function Chart({ changes, latest, best }: { changes: LpChange[]; latest: RankSnapshotDto | undefined; best: RankSnapshotDto | null }) {
  const { values, net, since } = lpSeries(changes)!;

  // Largeur mesuree sur la carte : le composant veut des pixels, et la colonne laterale
  // n'a pas de largeur fixe. Le format 540:696 est fixe par le composant (toute sa
  // geometrie est en unites de carte), la largeur est donc le seul levier sur la hauteur.
  // Plafonnee a 300 px — 390 px de haut — apres un premier essai a 480 px qui donnait une
  // carte de 537 px, trop grande pour une colonne laterale.
  const cadre = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(280);
  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const mesure = () => setLargeur(Math.round(Math.min(300, Math.max(220, el.clientWidth * 0.72))));
    mesure();
    const ro = new ResizeObserver(mesure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Un libelle par point, et il porte TOUT ce que le point sait : le rang reel, les LP reels,
  // la date. La serie tracee est le gain cumule depuis le premier releve — c'est ce que la
  // courbe montre et ce que la lecture annonce (« +30 LP »), jamais une valeur entre deux
  // releves. Le composant s'accroche au point le plus proche, il n'interpole pas.
  const libelles = [
    `Premier relevé · ${dateHeure(since)}`,
    ...changes.map((c) => `${TIER_LABEL[c.snapshot.tier] ?? c.snapshot.tier}${c.snapshot.division ? ` ${c.snapshot.division}` : ""} · ${c.snapshot.lp} LP · ${dateHeure(c.at)}`),
  ];

  return (
    <>
      <div ref={cadre} className="lp-cadre">
        <PeakChart
          width={largeur}
          data={values}
          labels={libelles}
          value={latest?.lp ?? 0}
          valueSuffix=" LP"
          title={latest ? `${TIER_LABEL[latest.tier] ?? latest.tier}${latest.division ? ` ${latest.division}` : ""}` : ""}
          caption={`${signed(net)} LP depuis le ${shortDate(since)} · ${changes.length} relevé${changes.length > 1 ? "s" : ""}`}
          updatedText="Relevé par NEX"
          trend={net > 0 ? "up" : net < 0 ? "down" : "none"}
          formatValue={(v) => `${signed(Math.round(v))} LP`}
          font="'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        />
      </div>
      <div className="lp-pied">
        {best && (
          <span className="muted">
            Meilleur relevé <b className="num">{rankText(best)}</b> le {shortDate(best.at)}
          </span>
        )}
      </div>
      <p className="muted lp-note">
        Un point par relevé de rang, pas par partie : Riot ne publie que le rang courant, NEX l'enregistre à chaque lecture du profil,
        et la courbe part de là.
      </p>
    </>
  );
}
