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
const longDate = (at: number) => new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const heure = (at: number) => new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
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

  return (
    <>
      <div className="lp-head">
        {latest && <span className="lp-now num">{rankText(latest)}</span>}
        <span className={`num ${net > 0 ? "pos" : net < 0 ? "neg" : "muted"}`}>{signed(net)} LP</span>
        <span className="muted num">
          depuis le {shortDate(since)} · {changes.length} changement{changes.length > 1 ? "s" : ""}
        </span>
      </div>
      <LineChart
        ariaLabel="Courbe des LP depuis le premier relevé"
        height={150}
        zeroLine
        series={[{ label: "LP gagnés depuis le premier relevé", color: "var(--accent)", values }]}
        xLabel={(i) => (i === 0 ? shortDate(since) : shortDate(changes[i - 1].at))}
        yFormat={(v) => signed(Math.round(v))}
        tooltip={(i) => <Bulle changes={changes} i={i} since={since} />}
      />
      {best && (
        <div className="lp-head">
          <span className="muted">Meilleur relevé</span>
          <span className="num" style={{ fontWeight: 600 }}>{rankText(best)}</span>
          <span className="muted num">le {shortDate(best.at)}</span>
        </div>
      )}
      <p className="muted lp-note">
        Un point par changement observé, pas par partie : si NEX n'a pas lu ce profil entre deux parties, leurs variations sont regroupées.
      </p>
    </>
  );
}

/**
 * Infobulle d'un point de la courbe.
 *
 * CE QU'ELLE NE DIT PAS : « Victoire » ou « Défaite ». Un point est un CHANGEMENT DE LP
 * entre deux relevés, pas une partie — si NEX n'a pas lu le profil entre deux parties,
 * leurs variations sont regroupées, et annoncer un résultat serait une invention. Quand
 * la fenêtre d'observation couvre plus d'une minute, elle est affichée telle quelle, ce
 * qui laisse juger de ce que le point recouvre.
 */
function Bulle({ changes, i, since }: { changes: LpChange[]; i: number; since: number }) {
  if (i === 0) {
    return (
      <>
        <div className="bulle-date">{longDate(since)}</div>
        <div className="muted">{heure(since)}</div>
        <div className="bulle-rang">Premier relevé</div>
        <div className="muted">Origine de la courbe, aucune variation avant.</div>
      </>
    );
  }
  const c = changes[i - 1];
  const s = c.snapshot;
  const fenetre = c.at - c.from;
  return (
    <>
      <div className="bulle-date">{longDate(c.at)}</div>
      <div className="muted">{heure(c.at)}</div>
      <div className="bulle-rang">
        {TIER_LABEL[s.tier] ?? s.tier}
        {s.division ? ` ${s.division}` : ""}
      </div>
      <div className="bulle-lp num">{s.lp} LP</div>
      <div className={`bulle-delta num ${c.delta > 0 ? "pos" : c.delta < 0 ? "neg" : "muted"}`}>
        {signed(c.delta)} LP
      </div>
      {fenetre > 60_000 && <div className="muted">relevé entre {heure(c.from)} et {heure(c.at)}</div>}
    </>
  );
}
