// Distinctions d'une partie : le rang de chaque joueur parmi les dix, et les badges
// qu'il a merites. Tout est calcule a partir du MatchDto deja charge : aucune requete.
//
// Rang — « indice de contribution », une moyenne ponderee de PARTS DANS SA PROPRE EQUIPE :
//   40 % participation aux eliminations (eliminations + assistances / eliminations d'equipe)
//   30 % part des degats aux champions
//   20 % part inverse des morts (mourir moins que ses coequipiers)
//   10 % part du score de vision
// Des parts, et non des valeurs absolues, pour que les dix joueurs restent comparables
// entre une equipe a 40 eliminations et une equipe a 10, et pour que la mesure vaille dans
// tous les modes (Faille, ARAM, Mayhem) sans reperes exterieurs. C'est une mesure de
// contribution visible, pas un jugement : un soutien marque peu de degats et sortira
// souvent derriere son porteur.
//
// MVP = meilleur indice de l'equipe gagnante, ACE = meilleur de l'equipe perdante ; les
// autres affichent leur rang sur les dix.
//
// Badge — un maximum de la partie n'est decerne que s'il depasse le deuxieme d'au moins
// MARGIN : sans cela « le plus de degats » recompense 24,3k contre 24,1k, ce qui ne
// distingue rien. Un champ absent (partie normalisee par une version anterieure, ou lue
// dans le client League) ne donne pas de badge : il n'est pas affiche, pas grise.
import type { MatchDto, ParticipantDto } from "../platform/api";
import { goldDiffAt15, teamOf } from "./fromMatch";

/** Avance minimale sur le deuxieme pour qu'un maximum soit remarquable. */
const MARGIN = 1.1;

/**
 * Avance d'or minimale a 15:00 pour parler de lane gagnee. En dessous, l'ecart tient a
 * une vague de sbires : ce n'est pas un avantage, c'est du bruit.
 */
const LANE_GOLD = 500;

export interface Badge {
  /** Cle stable, pour le rendu et les tests. */
  id: "lane" | "damage" | "vision" | "cc" | "objectives" | "tank" | "multikill" | "firstblood";
  label: string;
  /** Ce qui l'a declenche, montre en infobulle. */
  detail: string;
}

export interface Award {
  /** 1..10 sur les joueurs de la partie, du plus fort indice au plus faible. */
  rank: number;
  /** « MVP », « ACE », ou « 9e ». */
  rankLabel: string;
  /** Du plus parlant au moins parlant ; l'affichage n'en garde generalement que deux. */
  badges: Badge[];
}

const MULTI_KILL: Record<number, string> = {
  2: "Double élimination",
  3: "Triple élimination",
  4: "Quadruple élimination",
  5: "Pentakill",
};

const share = (value: number, total: number): number | null => (total > 0 ? value / total : null);

/** Indice de contribution d'un joueur, ou null si son equipe n'offre aucun repere. */
function contribution(m: MatchDto, p: ParticipantDto): number | null {
  const team = teamOf(m, p.teamId);
  const sum = (f: (x: ParticipantDto) => number) => team.reduce((a, x) => a + f(x), 0);
  const parts: [number, number | null][] = [
    [0.4, share(p.kills + p.assists, sum((x) => x.kills + x.assists))],
    [0.3, share(p.damageToChampions, sum((x) => x.damageToChampions))],
    // Part inverse des morts : 1 - sa part des morts de l'equipe. Une equipe sans mort
    // n'oppose personne, la composante est alors absente.
    [0.2, ((s) => (s === null ? null : 1 - s))(share(p.deaths, sum((x) => x.deaths)))],
    [0.1, share(p.visionScore, sum((x) => x.visionScore))],
  ];
  const kept = parts.filter((x): x is [number, number] => x[1] !== null);
  const weight = kept.reduce((a, [w]) => a + w, 0);
  return weight > 0 ? kept.reduce((a, [w, v]) => a + w * v, 0) / weight : null;
}

/**
 * Le joueur qui domine une statistique, s'il devance le deuxieme d'au moins `MARGIN`.
 * `pick` rend null quand la donnee manque : ces joueurs sont ecartes, et si personne ne
 * la fournit, personne n'a le badge.
 */
function leader(players: ParticipantDto[], pick: (p: ParticipantDto) => number | null): { p: ParticipantDto; value: number } | null {
  const vals = players.map((p) => ({ p, value: pick(p) })).filter((x): x is { p: ParticipantDto; value: number } => x.value !== null && x.value > 0);
  if (vals.length < 2) return null;
  vals.sort((a, b) => b.value - a.value);
  return vals[0].value >= vals[1].value * MARGIN ? vals[0] : null;
}

const k = (n: number) => `${(Math.round(n / 100) / 10).toFixed(1).replace(".", ",")}k`;

/**
 * Distinctions de chaque joueur de la partie, par `participantId`.
 * Une partie annulee (remake) n'en donne aucune : les chiffres n'y veulent rien dire.
 */
export function matchAwards(m: MatchDto): Map<number, Award> {
  const out = new Map<number, Award>();
  if (m.remake) return out;

  const ranked = m.participants
    .map((p) => ({ p, c: contribution(m, p) }))
    .filter((x): x is { p: ParticipantDto; c: number } => x.c !== null)
    .sort((a, b) => b.c - a.c);
  if (ranked.length === 0) return out;

  // MVP / ACE : le meilleur indice de chaque camp. `win` est porte par le joueur, ce qui
  // vaut aussi pour les parties lues dans le client ou `teams` peut manquer.
  const best = (win: boolean) => ranked.find((x) => x.p.win === win)?.p.participantId;
  const mvp = best(true);
  const ace = best(false);

  const tops = {
    damage: leader(m.participants, (p) => p.damageToChampions),
    tank: leader(m.participants, (p) => p.damageTaken),
    vision: leader(m.participants, (p) => p.visionScore),
    cc: leader(m.participants, (p) => p.ccTimeSec),
    objectives: leader(m.participants, (p) => p.damageToObjectives),
  };

  ranked.forEach(({ p }, i) => {
    const badges: Badge[] = [];
    const gd = goldDiffAt15(m, p);
    if (gd !== null && gd >= LANE_GOLD) badges.push({ id: "lane", label: "Lane gagnée", detail: `+${gd} or sur l'adversaire direct à 15:00` });
    if (tops.damage?.p === p) badges.push({ id: "damage", label: "Le plus de dégâts", detail: `${k(tops.damage.value)} de dégâts aux champions, le plus de la partie` });
    if (tops.vision?.p === p) badges.push({ id: "vision", label: "Meilleure vision", detail: `${tops.vision.value} de score de vision, le plus de la partie` });
    if (tops.cc?.p === p) badges.push({ id: "cc", label: "Le plus de contrôles", detail: `${tops.cc.value} s de contrôle de foule, le plus de la partie` });
    if (tops.objectives?.p === p)
      badges.push({ id: "objectives", label: "Objectifs", detail: `${k(tops.objectives.value)} de dégâts aux objectifs, le plus de la partie` });
    if (tops.tank?.p === p) badges.push({ id: "tank", label: "Le plus encaissé", detail: `${k(tops.tank.value)} de dégâts subis, le plus de la partie` });
    const multi = MULTI_KILL[p.largestMultiKill];
    if (multi) badges.push({ id: "multikill", label: multi, detail: `${p.largestMultiKill} éliminations d'affilée` });
    if (p.firstBlood) badges.push({ id: "firstblood", label: "Premier sang", detail: "A porté le premier sang de la partie" });

    const rank = i + 1;
    out.set(p.participantId, {
      rank,
      rankLabel: p.participantId === mvp ? "MVP" : p.participantId === ace ? "ACE" : `${rank}e`,
      badges,
    });
  });
  return out;
}

/** Distinctions d'un joueur donne, ou null s'il ne figure pas dans la partie. */
export function awardFor(m: MatchDto, puuid: string): Award | null {
  const me = m.participants.find((p) => p.puuid === puuid);
  return me ? matchAwards(m).get(me.participantId) ?? null : null;
}

/** Distinctions d'un joueur sur plusieurs parties, par identifiant de partie. */
export function awardsByMatch(matches: MatchDto[], puuid: string): Map<string, Award> {
  const out = new Map<string, Award>();
  for (const m of matches) {
    const a = awardFor(m, puuid);
    if (a) out.set(m.id, a);
  }
  return out;
}
