// MODE DEMONSTRATION : donnees fictives, deterministes, isolees du mode reel.
// Elles servent a tester l'interface sans backend. Elles ne doivent jamais etre
// affichees sans le marqueur "DÉMO" ni remplacer une erreur du mode reel.
import type { DataProvenance, MatchSummary, PlayerSummary, Queue, Role } from "../domain/types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Instant de reference fixe : les "il y a 2 h" restent stables d'un lancement a l'autre
// relativement a ce point, decale sur l'heure courante pour rester realiste.
const ANCHOR = Date.now();

const POOL: { champion: string; role: Role; weight: number }[] = [
  { champion: "Ahri", role: "MIDDLE", weight: 9 },
  { champion: "Syndra", role: "MIDDLE", weight: 7 },
  { champion: "Azir", role: "MIDDLE", weight: 5 },
  { champion: "Orianna", role: "MIDDLE", weight: 3 },
  { champion: "Viktor", role: "MIDDLE", weight: 3 },
  { champion: "Leblanc", role: "MIDDLE", weight: 2 },
  { champion: "Kaisa", role: "BOTTOM", weight: 2 },
  { champion: "Nautilus", role: "UTILITY", weight: 1 },
];

function pick<T extends { weight: number }>(rnd: () => number, items: T[]): T {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let r = rnd() * total;
  for (const i of items) {
    r -= i.weight;
    if (r <= 0) return i;
  }
  return items[items.length - 1];
}

export const DEMO_PROVENANCE: DataProvenance = {
  source: "demo",
  label: "Données de démonstration (fictives)",
  updatedAt: ANCHOR,
};

export const demoPlayer: PlayerSummary = {
  gameName: "NEX Démo",
  tagLine: "DEMO",
  platform: "EUW1",
  level: 412,
  profileIconId: 4568,
  bannerChampion: "Ahri",
  ranks: [
    { queue: "RANKED_SOLO_5x5", tier: "EMERALD", division: "II", lp: 64, wins: 88, losses: 71 },
    { queue: "RANKED_FLEX_SR", tier: "PLATINUM", division: "I", lp: 12, wins: 21, losses: 17 },
  ],
  updatedAt: ANCHOR,
};

function makeMatches(): MatchSummary[] {
  const rnd = mulberry32(20261107);
  const out: MatchSummary[] = [];
  let t = ANCHOR - 40 * 60 * 1000;
  for (let i = 0; i < 40; i++) {
    const p = pick(rnd, POOL);
    const queueRoll = rnd();
    const queue: Queue = queueRoll < 0.62 ? "solo" : queueRoll < 0.8 ? "flex" : queueRoll < 0.92 ? "normal" : "aram";
    const remake = i === 13;
    const durationSec = remake ? 205 : Math.round(1320 + rnd() * 900);
    const min = durationSec / 60;
    // Legere progression recente pour que les tendances soient visibles.
    const form = i < 10 ? 0.12 : 0;
    const win = remake ? false : rnd() < 0.53 + form;
    const teamKills = Math.round(min * (0.75 + rnd() * 0.5)) + (win ? 6 : 0);
    const kills = Math.round(teamKills * (0.18 + rnd() * 0.22));
    const assists = Math.round(teamKills * (0.2 + rnd() * 0.3));
    const deaths = Math.round(1 + rnd() * 7 - (win ? 1.5 : 0));
    const csm = p.role === "UTILITY" ? 0.9 + rnd() * 0.8 : 6.1 + rnd() * 2.6 + form * 2;
    const teamDamage = Math.round(min * (2600 + rnd() * 900));
    const share = p.role === "UTILITY" ? 0.08 + rnd() * 0.06 : 0.2 + rnd() * 0.12;
    const hasTimeline = !remake && rnd() > 0.15;
    const lp = queue === "solo" && !remake ? (win ? 18 + Math.round(rnd() * 6) : -(15 + Math.round(rnd() * 6))) : null;
    out.push({
      id: `DEMO_${7000000 + i}`,
      queue: queue === "aram" ? "aram" : queue,
      champion: queue === "aram" ? pick(rnd, POOL).champion : p.champion,
      championLevel: remake ? 3 : Math.min(18, Math.round(11 + min / 4 + rnd() * 2)),
      role: queue === "aram" ? null : p.role,
      win,
      remake,
      startedAt: t - durationSec * 1000,
      durationSec,
      kills: Math.max(0, kills),
      deaths: Math.max(0, deaths),
      assists: Math.max(0, assists),
      cs: Math.round(csm * min),
      teamKills: Math.max(1, teamKills),
      damageToChampions: Math.round(teamDamage * share),
      teamDamageToChampions: teamDamage,
      visionScore: Math.round(min * (p.role === "UTILITY" ? 2 : 0.7) * (0.8 + rnd() * 0.5)),
      soloKills: hasTimeline ? Math.round(rnd() * 3.2) : null,
      goldDiffAt15: hasTimeline ? Math.round((rnd() - 0.42 + form) * 1600) : null,
      lpDelta: lp,
    });
    t -= durationSec * 1000 + Math.round((20 + rnd() * 600) * 60 * 1000);
  }
  return out;
}

export const demoMatches: MatchSummary[] = makeMatches();

export interface DemoClip {
  id: string;
  title: string;
  kind: "clip" | "full";
  champion: string;
  skin: number;
  durationSec: number;
  createdAt: number;
  queueLabel: string;
  kda: string;
}

export const demoClips: DemoClip[] = [
  { id: "c1", title: "Triple au Baron", kind: "clip", champion: "Ahri", skin: 27, durationSec: 41, createdAt: ANCHOR - 41 * 60e3, queueLabel: "Classée Solo", kda: "12/3/16" },
  { id: "c2", title: "Flash charm", kind: "clip", champion: "Ahri", skin: 27, durationSec: 18, createdAt: ANCHOR - 62 * 60e3, queueLabel: "Classée Solo", kda: "12/3/16" },
  { id: "c3", title: "Vol de l'Ancien", kind: "clip", champion: "Syndra", skin: 3, durationSec: 22, createdAt: ANCHOR - 3 * 3600e3, queueLabel: "Classée Solo", kda: "5/4/17" },
  { id: "c4", title: "Insec au mid", kind: "clip", champion: "Azir", skin: 2, durationSec: 15, createdAt: ANCHOR - 4 * 3600e3, queueLabel: "Classée Flex", kda: "5/3/5" },
];

export const demoLastRecording: DemoClip = {
  id: "f1",
  title: "Partie complète",
  kind: "full",
  champion: "Ahri",
  skin: 27,
  durationSec: 1681,
  createdAt: ANCHOR - 12 * 60e3,
  queueLabel: "Classée Solo",
  kda: "12/3/16",
};

export const demoVod = {
  title: "Partie suivie",
  startedMinutesAgo: 24,
  region: "KR",
  blue: { name: "Suivi A", champion: "Riven" },
  jungle: { name: "Suivi B", champion: "LeeSin" },
  red: { name: "Suivi C", champion: "Jayce" },
};

export const demoCollection = { owned: 212, total: 482, champion: "Ahri", skin: 27 };
