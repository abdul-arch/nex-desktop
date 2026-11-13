import { describe, expect, it } from "vitest";
import type { MatchDto, ParticipantDto, TimelineDto, TimelineEventDto } from "../platform/api";
import { allSeries, FIGHT_GAP_MS, fights, story, teamSeries } from "./fights";

function p(id: number, team: number): ParticipantDto {
  return {
    participantId: id,
    puuid: `P${id}`,
    gameName: `J${id}`,
    tagLine: "T",
    champion: "Ahri",
    championId: 103,
    championLevel: 15,
    teamId: team,
    position: null,
    win: team === 100,
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    goldEarned: 0,
    damageToChampions: 0,
    damageTaken: 0,
    visionScore: 0,
    wardsPlaced: 0,
    wardsKilled: 0,
    controlWardsBought: 0,
    items: [0, 0, 0, 0, 0, 0, 0],
    spells: [4, 14],
    keystone: null,
    primaryStyle: null,
    secondaryStyle: null,
    perks: [],
    statPerks: [],
    soloKills: null,
    largestMultiKill: 1,
    firstBlood: null,
    ccTimeSec: null,
    damageToObjectives: null,
    damageToTurrets: null,
    largestKillingSpree: null,
    detectorWardsPlaced: null,
    timeDeadSec: null,
    turretPlates: null,
  };
}

/** Cinq bleus (1-5) contre cinq rouges (6-10). */
const match: MatchDto = {
  id: "EUW1_1",
  platform: "EUW1",
  queueId: 420,
  queue: "solo",
  gameMode: "CLASSIC",
  gameVersion: "15.22.1.1",
  startedAt: 0,
  durationSec: 1800,
  remake: false,
  participants: Array.from({ length: 10 }, (_, i) => p(i + 1, i < 5 ? 100 : 200)),
  teams: [],
  goldAt15: null,
};

const kill = (at: number, killerId: number, victimId: number, assistingIds: number[] = []): TimelineEventDto => ({
  at,
  timestamp: at,
  kind: "champion_kill",
  participantId: killerId,
  victimId,
  assistingIds,
}) as unknown as TimelineEventDto;

function timeline(events: TimelineEventDto[], frames: TimelineDto["frames"] = []): TimelineDto {
  return { matchId: "EUW1_1", frameIntervalMs: 60000, frames, events };
}

describe("fights", () => {
  it("regroupe les morts rapprochées et sépare les autres", () => {
    const t = timeline([kill(60_000, 1, 6), kill(64_000, 2, 7), kill(300_000, 6, 1)]);
    const f = fights(match, t);
    expect(f).toHaveLength(2);
    expect(f[0].kills).toHaveLength(2);
    expect(f[1].kills).toHaveLength(1);
  });

  it("prolonge un combat tant que les morts s'enchaînent", () => {
    // Chaque mort est à 9 s de la précédente : un seul combat, même sur 27 secondes.
    const t = timeline([kill(0, 1, 6), kill(9_000, 2, 7), kill(18_000, 3, 8), kill(27_000, 4, 9)]);
    const f = fights(match, t);
    expect(f).toHaveLength(1);
    expect(f[0].endsAt - f[0].at).toBe(27_000);
  });

  it("compte les morts par équipe", () => {
    const t = timeline([kill(0, 1, 6), kill(2_000, 2, 7), kill(4_000, 8, 3)]);
    const f = fights(match, t)[0];
    expect(f.deathsByTeam.get(200)).toBe(2);
    expect(f.deathsByTeam.get(100)).toBe(1);
  });

  it("respecte l'écart configuré", () => {
    const juste = timeline([kill(0, 1, 6), kill(FIGHT_GAP_MS, 2, 7)]);
    expect(fights(match, juste)).toHaveLength(1);
    const trop = timeline([kill(0, 1, 6), kill(FIGHT_GAP_MS + 1, 2, 7)]);
    expect(fights(match, trop)).toHaveLength(2);
  });

  it("ne rend aucun combat sans mort", () => {
    expect(fights(match, timeline([]))).toEqual([]);
  });
});

describe("story", () => {
  it("mêle combats, monstres et bâtiments dans l'ordre", () => {
    const t = timeline([
      kill(10_000, 1, 6),
      { timestamp: 20_000, kind: "elite_monster_kill", monsterType: "DRAGON", teamId: 100 } as TimelineEventDto,
      { timestamp: 30_000, kind: "building_kill", teamId: 200 } as TimelineEventDto,
    ]);
    const s = story(match, t);
    expect(s.map((e) => e.kind)).toEqual(["fight", "monster", "building"]);
    expect(s[1].monsterType).toBe("DRAGON");
  });

  it("tient le score cumulé, en l'attribuant à l'équipe adverse de la victime", () => {
    const t = timeline([kill(0, 1, 6), kill(60_000, 7, 2), kill(120_000, 3, 8)]);
    const s = story(match, t);
    expect([s[0].score.get(100), s[0].score.get(200)]).toEqual([1, 0]);
    expect([s[1].score.get(100), s[1].score.get(200)]).toEqual([1, 1]);
    expect([s[2].score.get(100), s[2].score.get(200)]).toEqual([2, 1]);
  });

  it("distingue escarmouche et combat d'équipe", () => {
    const petite = story(match, timeline([kill(0, 1, 6), kill(2_000, 2, 7)]));
    expect(petite[0].teamfight).toBe(false);
    const grande = story(match, timeline([kill(0, 1, 6), kill(2_000, 2, 7), kill(4_000, 3, 8)]));
    expect(grande[0].teamfight).toBe(true);
  });

  it("rend une avance d'or nulle sans frame", () => {
    expect(story(match, timeline([kill(0, 1, 6)]))[0].goldLead).toBeNull();
  });
});

describe("séries", () => {
  const frames: TimelineDto["frames"] = [
    { timestamp: 0, players: [{ participantId: 1, totalGold: 500, cs: 0, xp: 0, level: 1 }, { participantId: 6, totalGold: 500, cs: 0, xp: 0, level: 1 }] },
    { timestamp: 60_000, players: [{ participantId: 1, totalGold: 1200, cs: 10, xp: 900, level: 3 }, { participantId: 6, totalGold: 900, cs: 7, xp: 700, level: 2 }] },
  ];

  it("rend une série par joueur", () => {
    const s = allSeries(timeline([], frames));
    expect(s.get(1)).toEqual([
      { minute: 0, gold: 500, xp: 0, cs: 0 },
      { minute: 1, gold: 1200, xp: 900, cs: 10 },
    ]);
    expect(s.get(99)).toBeUndefined();
  });

  it("cumule par équipe et suit l'avance d'or", () => {
    const s = teamSeries(match, timeline([], frames), "gold");
    expect(s[1]).toEqual({ minute: 1, blue: 1200, red: 900 });
    expect(story(match, timeline([kill(60_000, 1, 6)], frames))[0].goldLead).toBe(300);
  });
});
