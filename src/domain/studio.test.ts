import { describe, expect, it } from "vitest";
import type { MatchDto, ParticipantDto } from "../platform/api";
import { byChampion, rolling, STUDIO_STATS, studioStat, toCsv, toStudioRows } from "./studio";

function part(id: string, team: number, win: boolean, over: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    participantId: 1,
    puuid: id,
    gameName: id,
    tagLine: "T",
    champion: "Ahri",
    championId: 103,
    championLevel: 15,
    teamId: team,
    position: "MIDDLE",
    win,
    kills: 2,
    deaths: 2,
    assists: 2,
    cs: 100,
    goldEarned: 10000,
    damageToChampions: 10000,
    damageTaken: 10000,
    visionScore: 20,
    wardsPlaced: 10,
    wardsKilled: 2,
    controlWardsBought: 2,
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
    ...over,
  };
}

const obj = (dragon: number) => ({ champion: 0, baron: 0, dragon, herald: 0, horde: 0, tower: 0, inhibitor: 0 });

function match(id: string, win: boolean, dur: number, extra: Partial<MatchDto> = {}, me: Partial<ParticipantDto> = {}): MatchDto {
  return {
    id,
    platform: "EUW1",
    queueId: 420,
    queue: "solo",
    gameMode: "CLASSIC",
    gameVersion: "15.1",
    startedAt: Number(id.slice(1)),
    durationSec: dur,
    remake: false,
    participants: [part("me", 100, win, { kills: 4, cs: 300, ...me }), part("ally", 100, win), part("foe", 200, !win)],
    teams: [
      { teamId: 100, win, bans: [], objectives: obj(win ? 3 : 1) },
      { teamId: 200, win: !win, bans: [], objectives: obj(win ? 1 : 3) },
    ],
    goldAt15: null,
    ...extra,
  };
}

describe("data studio", () => {
  const rows = toStudioRows(
    [match("m1", true, 1800), match("m2", false, 1200), match("m3", true, 200), match("m4", true, 1500, { queue: "arena", gameMode: "CHERRY" })],
    "me",
  );

  it("exclut parties courtes et Arena, trie du plus recent au plus ancien", () => {
    expect(rows.map((r) => r.id)).toEqual(["m2", "m1"]);
  });

  it("agrège les taux en ratios de sommes", () => {
    const cs = studioStat("csPerMin");
    expect(cs.aggregate(rows)).toBeCloseTo(600 / 50);
    const kp = studioStat("killParticipation");
    expect(kp.perGame(rows[0])).toBeCloseTo(6 / 6);
  });

  it("rend null plutôt qu'un zéro quand la donnée manque", () => {
    // Aucune timeline, et aucun des champs optionnels de Riot n'est renseigné.
    for (const key of ["goldDiff15", "soloKills", "ccTime", "timeDead", "objectiveDamage"]) {
      expect(studioStat(key).aggregate(rows), key).toBeNull();
    }
  });

  it("n'agrège que les parties qui portent la donnée", () => {
    const mixed = toStudioRows([match("m1", true, 1800, {}, { ccTimeSec: 60 }), match("m2", false, 1200)], "me");
    // Une seule partie sur deux porte la mesure : la moyenne est celle de cette partie.
    expect(studioStat("ccTime").aggregate(mixed)).toBe(60);
  });

  it("classe les champions selon le sens de la mesure", () => {
    const rs = toStudioRows(
      [
        match("m1", true, 1800, {}, { champion: "Ahri", cs: 360 }),
        match("m2", true, 1800, {}, { champion: "Zed", championId: 238, cs: 180 }),
      ],
      "me",
    );
    // CS/min : plus haut d'abord.
    expect(byChampion(rs, studioStat("csPerMin")).map((c) => c.champion)).toEqual(["Ahri", "Zed"]);
    // Morts / 10 min : plus bas d'abord, puisque mourir moins vaut mieux.
    const deaths = toStudioRows(
      [
        match("m1", true, 1800, {}, { champion: "Ahri", deaths: 10 }),
        match("m2", true, 1800, {}, { champion: "Zed", championId: 238, deaths: 1 }),
      ],
      "me",
    );
    expect(byChampion(deaths, studioStat("deathsPer10")).map((c) => c.champion)).toEqual(["Zed", "Ahri"]);
  });

  it("écarte du classement les champions dont aucune partie ne porte la donnée", () => {
    expect(byChampion(rows, studioStat("soloKills"))).toEqual([]);
  });

  it("donne à chaque mesure du catalogue une clé unique et un libellé", () => {
    const keys = STUDIO_STATS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(STUDIO_STATS.every((s) => s.label.length > 0 && s.help.length > 0)).toBe(true);
  });

  it("moyenne glissante et export CSV", () => {
    expect(rolling([1, 2, 3, null, 5], 2)).toEqual([null, 1.5, 2.5, null, null]);
    expect(toCsv(rows).split("\n")).toHaveLength(3);
  });
});
