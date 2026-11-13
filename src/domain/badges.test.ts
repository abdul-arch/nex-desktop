import { describe, expect, it } from "vitest";
import type { MatchDto, ParticipantDto } from "../platform/api";
import { awardFor, matchAwards } from "./badges";

function p(n: number, team: number, extra: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    participantId: n,
    puuid: `puuid-${n}`,
    gameName: `J${n}`,
    tagLine: "TEST",
    champion: "Ahri",
    championId: 103,
    championLevel: 15,
    teamId: team,
    position: null,
    win: team === 100,
    kills: 5,
    deaths: 5,
    assists: 5,
    cs: 100,
    goldEarned: 10000,
    damageToChampions: 10000,
    damageTaken: 10000,
    visionScore: 10,
    wardsPlaced: 5,
    wardsKilled: 1,
    controlWardsBought: 1,
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
    ...extra,
  };
}

/** Dix joueurs identiques, que chaque test differencie. */
function match(participants: ParticipantDto[], extra: Partial<MatchDto> = {}): MatchDto {
  return {
    id: "EUW1_1",
    platform: "EUW1",
    queueId: 420,
    queue: "solo",
    gameMode: "CLASSIC",
    gameVersion: "15.22.1.1",
    startedAt: 1_700_000_000_000,
    durationSec: 1800,
    remake: false,
    participants,
    teams: [],
    goldAt15: null,
    ...extra,
  };
}

const ten = (over: Record<number, Partial<ParticipantDto>> = {}) =>
  Array.from({ length: 10 }, (_, i) => p(i + 1, i < 5 ? 100 : 200, over[i + 1] ?? {}));

const badgeIds = (m: MatchDto, id: number) => matchAwards(m).get(id)?.badges.map((b) => b.id) ?? [];

describe("matchAwards", () => {
  it("décerne un maximum seulement s'il devance le deuxième de 10 %", () => {
    const serre = match(ten({ 1: { damageToChampions: 24_300 }, 2: { damageToChampions: 24_100 } }));
    expect(badgeIds(serre, 1)).not.toContain("damage");

    const net = match(ten({ 1: { damageToChampions: 40_000 } }));
    expect(badgeIds(net, 1)).toContain("damage");
  });

  it("n'invente pas de badge quand la donnée manque", () => {
    // ccTimeSec et damageToObjectives valent null partout : parties d'avant la v2 de
    // normalisation, ou lues dans le client League.
    const m = match(ten({ 1: { ccTimeSec: null, damageToObjectives: null } }));
    for (let i = 1; i <= 10; i++) {
      expect(badgeIds(m, i)).not.toContain("cc");
      expect(badgeIds(m, i)).not.toContain("objectives");
    }
  });

  it("reconnaît le contrôle de foule et les objectifs quand Riot les fournit", () => {
    // Riot renseigne ces champs pour les dix joueurs : la comparaison a un sens.
    const tous = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, { ccTimeSec: 10, damageToObjectives: 5_000 }]));
    const m = match(ten({ ...tous, 3: { ccTimeSec: 80, damageToObjectives: 30_000 } }));
    expect(badgeIds(m, 3)).toEqual(expect.arrayContaining(["cc", "objectives"]));
  });

  it("ne compare pas un joueur seul à renseigner la donnée", () => {
    // Un seul des dix a la valeur : « le plus de » ne veut rien dire, aucun badge.
    const m = match(ten({ 3: { ccTimeSec: 80 } }));
    expect(badgeIds(m, 3)).not.toContain("cc");
  });

  it("ne donne aucune distinction sur un remake", () => {
    const m = match(ten({ 1: { damageToChampions: 99_000, firstBlood: true } }), { remake: true });
    expect(matchAwards(m).size).toBe(0);
  });

  it("nomme MVP le meilleur des gagnants et ACE le meilleur des perdants", () => {
    // J2 porte son équipe gagnante, J10 porte son équipe perdante.
    const m = match(
      ten({
        2: { kills: 20, assists: 10, deaths: 1, damageToChampions: 40_000 },
        10: { kills: 15, assists: 10, deaths: 2, damageToChampions: 35_000 },
      }),
    );
    const a = matchAwards(m);
    expect(a.get(2)?.rankLabel).toBe("MVP");
    expect(a.get(10)?.rankLabel).toBe("ACE");
    // Personne d'autre ne porte ces libellés, et les rangs restent uniques.
    const labels = [...a.values()].map((x) => x.rankLabel);
    expect(labels.filter((l) => l === "MVP")).toHaveLength(1);
    expect(labels.filter((l) => l === "ACE")).toHaveLength(1);
    expect(new Set([...a.values()].map((x) => x.rank)).size).toBe(10);
  });

  it("compare des parts d'équipe, pas des totaux", () => {
    // L'équipe bleue tue beaucoup, la rouge très peu. Le porteur rouge (J6 : 80 % des
    // éliminations et des dégâts des siens) doit passer devant un bleu quelconque (J3).
    const m = match(
      ten({
        1: { kills: 10, assists: 10, damageToChampions: 30_000 },
        2: { kills: 10, assists: 10, damageToChampions: 30_000 },
        3: { kills: 2, assists: 2, damageToChampions: 6_000 },
        6: { kills: 8, assists: 8, damageToChampions: 24_000, deaths: 2 },
        7: { kills: 1, assists: 0, damageToChampions: 2_000 },
        8: { kills: 1, assists: 0, damageToChampions: 2_000 },
        9: { kills: 0, assists: 1, damageToChampions: 2_000 },
        10: { kills: 0, assists: 1, damageToChampions: 2_000 },
      }),
    );
    const a = matchAwards(m);
    expect(a.get(6)!.rank).toBeLessThan(a.get(3)!.rank);
  });

  it("ne donne « Lane gagnée » que sur une avance d'or réelle à 15:00", () => {
    const lanes = { 1: { position: "MIDDLE" }, 6: { position: "MIDDLE" } };
    const avec = (or: number) => match(ten(lanes), { goldAt15: Array.from({ length: 10 }, (_, i) => (i === 0 ? 5000 + or : 5000)) });

    // Timeline absente : l'écart est inconnu, pas nul.
    expect(badgeIds(match(ten(lanes)), 1)).not.toContain("lane");
    // Une poignée d'or tient à une vague de sbires : ce n'est pas une lane gagnée.
    expect(badgeIds(avec(137), 1)).not.toContain("lane");
    expect(badgeIds(avec(1000), 1)).toContain("lane");
    // L'adversaire, lui, est en retard : pas de badge.
    expect(badgeIds(avec(1000), 6)).not.toContain("lane");
  });

  it("nomme le multi-kill et le premier sang", () => {
    const m = match(ten({ 4: { largestMultiKill: 3, firstBlood: true } }));
    const b = matchAwards(m).get(4)!.badges;
    expect(b.find((x) => x.id === "multikill")?.label).toBe("Triple élimination");
    expect(b.map((x) => x.id)).toContain("firstblood");
    // Une élimination simple n'est pas un multi-kill.
    expect(badgeIds(m, 5)).not.toContain("multikill");
  });

  it("awardFor retrouve le joueur par son puuid, et null s'il est absent", () => {
    const m = match(ten());
    expect(awardFor(m, "puuid-4")?.rank).toBe(matchAwards(m).get(4)?.rank);
    expect(awardFor(m, "inconnu")).toBeNull();
  });
});
