import { describe, expect, it } from "vitest";
import type { MatchDto, ParticipantDto, TimelineDto } from "../platform/api";
import { goldDiffAt15, groupPurchases, laneOpponent, mergeLocalMatches, purchaseOrder, skillOrder, toSummary } from "./fromMatch";

function p(id: number, team: number, extra: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    participantId: id,
    puuid: `P${id}`,
    gameName: `J${id}`,
    tagLine: "TEST",
    champion: "Ahri",
    championId: 103,
    championLevel: 15,
    teamId: team,
    position: null,
    win: team === 100,
    kills: 2,
    deaths: 2,
    assists: 2,
    cs: 150,
    goldEarned: 10000,
    damageToChampions: 10000,
    damageTaken: 10000,
    visionScore: 20,
    wardsPlaced: 5,
    wardsKilled: 1,
    controlWardsBought: 1,
    items: [0, 0, 0, 0, 0, 0, 3340],
    spells: [4, 14],
    keystone: 8112,
    primaryStyle: 8100,
    secondaryStyle: 8200,
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
    ...extra,
  };
}

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
  participants: [
    p(1, 100, { position: "MIDDLE", kills: 10, assists: 5, damageToChampions: 30000 }),
    p(2, 100, { position: "JUNGLE", kills: 5 }),
    p(3, 200, { position: "MIDDLE" }),
    p(4, 200, { position: "JUNGLE" }),
  ],
  teams: [],
  goldAt15: [6000, 5000, 5200, 4800],
};

describe("fusion des parties du client (ARAM Mayhem)", () => {
  const at = (id: string, startedAt: number, queueId = 420): MatchDto => ({ ...match, id, startedAt, queueId });
  const remote = [at("R3", 300), at("R2", 200), at("R1", 100)];
  const local = [at("L4", 400, 2400), at("L2", 250, 2400), at("L0", 50, 2400)];

  it("tant que Riot a d'autres parties, n'ajoute pas les parties locales plus anciennes", () => {
    expect(mergeLocalMatches(remote, local, true).map((m) => m.id)).toEqual(["L4", "R3", "L2", "R2", "R1"]);
  });
  it("ajoute tout quand l'historique Riot est entièrement chargé", () => {
    expect(mergeLocalMatches(remote, local, false).map((m) => m.id)).toEqual(["L4", "R3", "L2", "R2", "R1", "L0"]);
  });
  it("sans doublon, et sans rien inventer", () => {
    expect(mergeLocalMatches(remote, [at("R2", 200)], false)).toHaveLength(3);
    expect(mergeLocalMatches(remote, [], true)).toBe(remote);
    // Aucune partie Riot affichée et d'autres à charger : on attend la première page.
    expect(mergeLocalMatches([], local, true)).toEqual([]);
    expect(mergeLocalMatches([], local, false).map((m) => m.id)).toEqual(["L4", "L2", "L0"]);
  });
});

describe("conversion d'un match", () => {
  it("vue joueur : totaux d'équipe et écart d'or vs adversaire direct", () => {
    const s = toSummary(match, "P1")!;
    expect(s.teamKills).toBe(15);
    expect(s.teamDamageToChampions).toBe(40000);
    expect(s.goldDiffAt15).toBe(800);
    expect(s.role).toBe("MIDDLE");
    expect(s.lpDelta).toBeNull();
    expect(toSummary(match, "INCONNU")).toBeNull();
  });

  it("pas d'écart d'or sans timeline ou sans adversaire de même poste", () => {
    expect(goldDiffAt15({ ...match, goldAt15: null }, match.participants[0])).toBeNull();
    const noPos = { ...match.participants[0], position: null };
    expect(laneOpponent(match, noPos)).toBeUndefined();
  });
});

describe("timeline", () => {
  const t: TimelineDto = {
    matchId: "EUW1_1",
    frameIntervalMs: 60000,
    frames: [],
    events: [
      { timestamp: 1000, kind: "item_purchased", participantId: 1, itemId: 1055 },
      { timestamp: 1500, kind: "item_purchased", participantId: 1, itemId: 2003 },
      { timestamp: 2000, kind: "item_undo", participantId: 1, beforeItemId: 2003, itemId: 0 },
      { timestamp: 2500, kind: "item_purchased", participantId: 2, itemId: 1102 },
      { timestamp: 300000, kind: "item_purchased", participantId: 1, itemId: 3802 },
      { timestamp: 900000, kind: "item_sold", participantId: 1, itemId: 1055 },
      { timestamp: 61000, kind: "skill_level_up", participantId: 1, skillSlot: 1 },
      { timestamp: 120000, kind: "skill_level_up", participantId: 1, skillSlot: 3 },
    ],
  };

  it("ordre d'achat : annulations retirées, ventes conservées", () => {
    const steps = purchaseOrder(t, 1);
    expect(steps.map((s) => `${s.kind}:${s.itemId}`)).toEqual(["buy:1055", "buy:3802", "sell:1055"]);
    expect(groupPurchases(steps).length).toBe(3);
  });

  it("ordre des compétences", () => {
    expect(skillOrder(t, 1)).toEqual([1, 3]);
  });
});
