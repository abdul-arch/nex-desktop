// Lecture narrative d'une partie : combats, objectifs et bâtiments, dans l'ordre.
//
// La timeline de Riot ne donne que des événements isolés. Ce module les regroupe en
// combats, parce qu'une partie se raconte en affrontements, pas en morts séparées.
//
// Limite assumée : la timeline normalisée par NEX ne porte pas la position des
// événements, le regroupement se fait donc sur le seul écart de temps. Deux
// escarmouches simultanées aux deux bouts de la carte seront comptées comme un seul
// combat. C'est rare, et préférable à inventer des coordonnées.
import type { MatchDto, TimelineDto, TimelineEventDto } from "../platform/api";

/** Écart maximal entre deux morts d'un même combat. */
export const FIGHT_GAP_MS = 10_000;
/** À partir de ce nombre de morts, on parle de combat d'équipe et non d'escarmouche. */
export const TEAMFIGHT_DEATHS = 3;

export interface FightKill {
  at: number;
  /** null si Riot n'attribue l'élimination à personne (exécution par une tourelle, sbires). */
  killerId: number | null;
  victimId: number;
  assistingIds: number[];
}

export interface Fight {
  at: number;
  endsAt: number;
  kills: FightKill[];
  /** Morts subies, par équipe. */
  deathsByTeam: Map<number, number>;
}

/** Regroupe les éliminations en combats, du plus ancien au plus récent. */
export function fights(match: MatchDto, t: TimelineDto, gapMs = FIGHT_GAP_MS): Fight[] {
  const teamOf = new Map(match.participants.map((p) => [p.participantId, p.teamId]));
  const kills = t.events
    .filter((e) => e.kind === "champion_kill" && e.victimId)
    .map((e) => ({ at: e.timestamp, killerId: e.participantId ?? null, victimId: e.victimId as number, assistingIds: e.assistingIds ?? [] }))
    .sort((a, b) => a.at - b.at);

  const out: Fight[] = [];
  for (const k of kills) {
    const last = out[out.length - 1];
    if (last && k.at - last.endsAt <= gapMs) {
      last.kills.push(k);
      last.endsAt = k.at;
    } else {
      out.push({ at: k.at, endsAt: k.at, kills: [k], deathsByTeam: new Map() });
    }
  }
  for (const f of out) {
    for (const k of f.kills) {
      const team = teamOf.get(k.victimId);
      if (team !== undefined) f.deathsByTeam.set(team, (f.deathsByTeam.get(team) ?? 0) + 1);
    }
  }
  return out;
}

export type StoryKind = "fight" | "monster" | "building";

export interface StoryEntry {
  at: number;
  kind: StoryKind;
  /** Combat : présent seulement quand `kind` vaut "fight". */
  fight?: Fight;
  /** Combat d'équipe plutôt qu'escarmouche. */
  teamfight?: boolean;
  /** Monstre épique (DRAGON, BARON_NASHOR…) ou bâtiment, tel que Riot le nomme. */
  monsterType?: string;
  /** Équipe qui a pris l'objectif, ou qui a perdu le bâtiment. */
  teamId?: number;
  /** Éliminations cumulées de chaque équipe juste après cette entrée. */
  score: Map<number, number>;
  /** Avance d'or de l'équipe 100 au moment de l'entrée, null hors des frames connues. */
  goldLead: number | null;
}

/** Or total d'une équipe à l'instant le plus proche de `at`. */
function goldLeadAt(match: MatchDto, t: TimelineDto, at: number): number | null {
  if (!t.frames.length) return null;
  const frame = t.frames.reduce((best, f) => (Math.abs(f.timestamp - at) < Math.abs(best.timestamp - at) ? f : best));
  const teamOf = new Map(match.participants.map((p) => [p.participantId, p.teamId]));
  let blue = 0;
  let red = 0;
  for (const p of frame.players) {
    const team = teamOf.get(p.participantId);
    if (team === 100) blue += p.totalGold;
    else if (team === 200) red += p.totalGold;
  }
  return blue - red;
}

/**
 * Déroulé de la partie : combats, monstres épiques et bâtiments mêlés, dans l'ordre,
 * chacun avec le score du moment et l'avance d'or de l'équipe bleue.
 */
export function story(match: MatchDto, t: TimelineDto): StoryEntry[] {
  const teamOf = new Map(match.participants.map((p) => [p.participantId, p.teamId]));
  const entries: Omit<StoryEntry, "score" | "goldLead">[] = [];

  for (const f of fights(match, t)) {
    const deaths = [...f.deathsByTeam.values()].reduce((a, b) => a + b, 0);
    entries.push({ at: f.at, kind: "fight", fight: f, teamfight: deaths >= TEAMFIGHT_DEATHS });
  }
  const other = (e: TimelineEventDto, kind: StoryKind) => entries.push({ at: e.timestamp, kind, monsterType: e.monsterType, teamId: e.teamId });
  for (const e of t.events) {
    if (e.kind === "elite_monster_kill") other(e, "monster");
    else if (e.kind === "building_kill") other(e, "building");
  }
  entries.sort((a, b) => a.at - b.at);

  // Score cumulé : on repasse sur les entrées dans l'ordre pour l'incrémenter.
  const score = new Map<number, number>([
    [100, 0],
    [200, 0],
  ]);
  return entries.map((e) => {
    if (e.fight) {
      for (const k of e.fight.kills) {
        const victimTeam = teamOf.get(k.victimId);
        // Une élimination compte pour l'équipe adverse à celle de la victime.
        const scorer = victimTeam === 100 ? 200 : victimTeam === 200 ? 100 : null;
        if (scorer !== null) score.set(scorer, (score.get(scorer) ?? 0) + 1);
      }
    }
    return { ...e, score: new Map(score), goldLead: goldLeadAt(match, t, e.at) };
  });
}

/**
 * Séries par minute de chaque joueur : or, XP et CS.
 * Toutes les données sont déjà dans la timeline téléchargée, aucune requête de plus.
 */
export function allSeries(t: TimelineDto): Map<number, { minute: number; gold: number; xp: number; cs: number }[]> {
  const out = new Map<number, { minute: number; gold: number; xp: number; cs: number }[]>();
  for (const f of t.frames) {
    const minute = Math.round(f.timestamp / 60000);
    for (const p of f.players) {
      const list = out.get(p.participantId) ?? [];
      list.push({ minute, gold: p.totalGold, xp: p.xp, cs: p.cs });
      out.set(p.participantId, list);
    }
  }
  return out;
}

/** Or (ou XP, ou CS) cumulé de chaque équipe, minute par minute. */
export function teamSeries(match: MatchDto, t: TimelineDto, field: "gold" | "xp" | "cs"): { minute: number; blue: number; red: number }[] {
  const teamOf = new Map(match.participants.map((p) => [p.participantId, p.teamId]));
  return t.frames.map((f) => {
    let blue = 0;
    let red = 0;
    for (const p of f.players) {
      const v = field === "gold" ? p.totalGold : field === "xp" ? p.xp : p.cs;
      const team = teamOf.get(p.participantId);
      if (team === 100) blue += v;
      else if (team === 200) red += v;
    }
    return { minute: Math.round(f.timestamp / 60000), blue, red };
  });
}
