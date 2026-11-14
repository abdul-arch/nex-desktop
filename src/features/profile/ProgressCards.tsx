// Cartes de progression : la semaine ecoulee, la mesure a travailler et les distinctions.
//
// Elles vivaient sur l'accueil, qui suit desormais la maquette de reference et ne les
// contient plus. Elles ne sont pas supprimees pour autant : elles disent ce que les
// moyennes ne disent pas, et ont leur place sur le profil.
import { useMemo } from "react";
import { useNav } from "../../app/navigation";
import { useAsync } from "../../app/useAsync";
import type { Award } from "../../domain/badges";
import { dayLabel, groupByDay } from "../../domain/sessions";
import type { MatchSummary } from "../../domain/types";
import { platform } from "../../platform";
import type { BaselinesDto } from "../../platform/api";
import { duration, pct } from "../../ui/format";

/** Minuit local du jour d'un horodatage. */
function midnightOf(at: number) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Sept derniers jours : une barre par jour, hauteur selon les parties, couleur selon le bilan. */
export function WeekCard({ matches }: { matches: MatchSummary[] }) {
  const days = useMemo(() => {
    const groups = new Map(groupByDay(matches).map((g) => [g.day, g]));
    const today = midnightOf(Date.now());
    return Array.from({ length: 7 }, (_, i) => {
      const day = today - (6 - i) * 86_400_000;
      const g = groups.get(day);
      return { day, games: g?.games ?? 0, wins: g?.wins ?? 0, losses: g?.losses ?? 0 };
    });
  }, [matches]);
  const max = Math.max(1, ...days.map((d) => d.games));
  const total = days.reduce((a, d) => ({ games: a.games + d.games, wins: a.wins + d.wins, losses: a.losses + d.losses }), { games: 0, wins: 0, losses: 0 });
  const minutes = matches.filter((m) => m.startedAt >= midnightOf(Date.now()) - 6 * 86_400_000).reduce((a, m) => a + m.durationSec, 0);
  if (total.games === 0) return null;

  return (
    <section className="card card-pad week-card" aria-label="Ta semaine">
      <div className="card-title">Ta semaine</div>
      <div className="week-bars">
        {days.map((d) => (
          <span
            key={d.day}
            title={d.games === 0 ? `${dayLabel(d.day)} : aucune partie` : `${dayLabel(d.day)} : ${d.games} partie${d.games > 1 ? "s" : ""}, ${d.wins}V ${d.losses}D`}
            data-issue={d.games === 0 ? "none" : d.wins >= d.losses ? "win" : "loss"}
            style={{ height: `${d.games === 0 ? 12 : 12 + (d.games / max) * 88}%` }}
          />
        ))}
      </div>
      <div className="muted num week-total">
        {total.games} partie{total.games > 1 ? "s" : ""} · {total.wins}V {total.losses}D · {duration(minutes)} de jeu
      </div>
    </section>
  );
}

/** Mesures du joueur comparables aux medianes collectees, sur les memes cles. */
const STEP_METRICS: { key: string; label: string; higherIsBetter: boolean; format: (v: number) => string; value: (ms: MatchSummary[]) => number | null }[] = [
  { key: "csPerMin", label: "CS / min", higherIsBetter: true, format: (v) => v.toFixed(1), value: (ms) => ratioOf(ms, (m) => m.cs, (m) => m.durationSec / 60) },
  { key: "visionPerMin", label: "Vision / min", higherIsBetter: true, format: (v) => v.toFixed(2), value: (ms) => ratioOf(ms, (m) => m.visionScore, (m) => m.durationSec / 60) },
  { key: "killParticipation", label: "Participation", higherIsBetter: true, format: (v) => pct(v), value: (ms) => ratioOf(ms, (m) => m.kills + m.assists, (m) => m.teamKills) },
  { key: "damageShare", label: "Part des dégâts", higherIsBetter: true, format: (v) => pct(v), value: (ms) => ratioOf(ms, (m) => m.damageToChampions, (m) => m.teamDamageToChampions) },
  { key: "deathsPer10", label: "Morts / 10 min", higherIsBetter: false, format: (v) => v.toFixed(1), value: (ms) => ratioOf(ms, (m) => m.deaths * 10, (m) => m.durationSec / 60) },
];

function ratioOf(ms: MatchSummary[], num: (m: MatchSummary) => number, den: (m: MatchSummary) => number): number | null {
  const d = ms.reduce((a, m) => a + den(m), 0);
  return d > 0 ? ms.reduce((a, m) => a + num(m), 0) / d : null;
}

/**
 * La mesure ou l'ecart a la mediane collectee est le plus defavorable. Une seule : le heros
 * affiche deja huit moyennes, cette carte sert a savoir quoi travailler.
 */
export function NextStepCard({ matches, role }: { matches: MatchSummary[]; role: string | null }) {
  const { navigate } = useNav();
  const base = useAsync<BaselinesDto>(`baselines:${role ?? "all"}`, () => platform.statsBaselines(role ? { position: role } : {}), 600_000);
  const worst = useMemo(() => {
    if (!base.data || matches.length === 0) return null;
    let pick: { label: string; mine: number; median: number; gap: number; format: (v: number) => string } | null = null;
    for (const m of STEP_METRICS) {
      const mine = m.value(matches);
      const median = base.data.stats.find((s) => s.key === m.key)?.median ?? null;
      if (mine === null || median === null || median === 0) continue;
      // Ecart relatif, signe pour que « plus grand » soit toujours « pire ».
      const gap = ((median - mine) / Math.abs(median)) * (m.higherIsBetter ? 1 : -1);
      if (gap > 0 && (!pick || gap > pick.gap)) pick = { label: m.label, mine, median, gap, format: m.format };
    }
    return pick;
  }, [base.data, matches]);

  if (!worst) return null;
  return (
    <button className="card card-pad card-link step-card" onClick={() => navigate("datastudio")}>
      <div className="card-title">Ta prochaine marche</div>
      <strong className="step-name">{worst.label}</strong>
      <div className="step-values num">
        <span className="neg">{worst.format(worst.mine)}</span>
        <span className="muted">médiane {worst.format(worst.median)}</span>
      </div>
      <div className="muted step-note">
        Ton plus gros écart sur {matches.length} partie{matches.length > 1 ? "s" : ""}, face aux parties collectées par NEX.
      </div>
    </button>
  );
}

/** Distinctions accumulees sur les parties chargees : du vecu, pas une moyenne de plus. */
export function HighlightsCard({ awards }: { awards?: Map<string, Award> }) {
  const lines = useMemo(() => {
    if (!awards?.size) return [];
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const a of awards.values()) {
      if (a.rankLabel === "MVP" || a.rankLabel === "ACE") bump(a.rankLabel);
      for (const b of a.badges) bump(b.label);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [awards]);
  if (lines.length === 0) return null;

  return (
    <section className="card card-pad highlights-card" aria-label="Faits marquants">
      <div className="card-title">Faits marquants</div>
      <ul>
        {lines.map(([label, n]) => (
          <li key={label}>
            <b className="num">{n}×</b> {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
