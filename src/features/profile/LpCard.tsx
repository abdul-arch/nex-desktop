// Historique des LP d'un compte, trace a partir des releves enregistres par le backend.
//
// Riot ne sert que le rang courant : cette carte ne montre que ce que NEX a observe depuis
// le premier releve. Aucune reconstitution du passe, aucune interpolation entre deux releves.
import { useState } from "react";
import { useAsync } from "../../app/useAsync";
import { ladderPoints, type LpChange, lpChanges, lpSeries } from "../../domain/lp";
import { platform } from "../../platform";
import type { RankSnapshotDto } from "../../platform/api";
import { LineChart } from "../../ui/LineChart";
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
  // Point survole. L'en-tete porte l'information a la place d'une bulle flottante : sur une
  // carte de cette largeur, une bulle recouvrirait la courbe qu'on essaie de lire.
  const [survol, setSurvol] = useState<number | null>(null);
  const vise = survol === null ? null : survol === 0 ? null : changes[survol - 1];

  return (
    <>
      <div className="lp-lecture">
        {vise ? (
          <span className="lp-vise">
            <span className="lp-vise-rang">
              {TIER_LABEL[vise.snapshot.tier] ?? vise.snapshot.tier}
              {vise.snapshot.division ? ` ${vise.snapshot.division}` : ""}
            </span>
            <span className="lp-vise-ligne">
              <b className="lp-vise-lp num">{vise.snapshot.lp} LP</b>
              <span className="muted num">{dateHeure(vise.at)}</span>
              <span className={`num ${vise.delta > 0 ? "pos" : vise.delta < 0 ? "neg" : "muted"}`}>{signed(vise.delta)}</span>
            </span>
          </span>
        ) : survol === 0 ? (
          <span className="lp-vise">
            <span className="lp-vise-rang">Premier relevé</span>
            <span className="lp-vise-ligne">
              <span className="muted num">{dateHeure(since)}</span>
              <span className="muted">origine de la courbe</span>
            </span>
          </span>
        ) : (
          <>
            {latest && <span className="lp-now num">{rankText(latest)}</span>}
            <span className={`num ${net > 0 ? "pos" : net < 0 ? "neg" : "muted"}`}>{signed(net)} LP</span>
            <span className="muted num">
              depuis le {shortDate(since)} · {changes.length} relevé{changes.length > 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>

      <LineChart
        ariaLabel="Courbe des LP depuis le premier relevé"
        height={78}
        compact
        series={[{ label: "LP", color: "var(--accent)", values }]}
        onHover={setSurvol}
      />

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
