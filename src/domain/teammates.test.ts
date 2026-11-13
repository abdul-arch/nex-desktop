import { describe, expect, it } from "vitest";
import type { MatchDto, ParticipantDto } from "../platform/api";
import { frequentTeammates } from "./teammates";

function p(id: string, team: number, extra: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    participantId: 1,
    puuid: id,
    gameName: id,
    tagLine: "TEST",
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
    ...extra,
  };
}

function match(id: string, startedAt: number, mine: ParticipantDto[], others: ParticipantDto[] = [], remake = false): MatchDto {
  return {
    id,
    platform: "EUW1",
    queueId: 420,
    queue: "solo",
    gameMode: "CLASSIC",
    gameVersion: "15.22.1.1",
    startedAt,
    durationSec: remake ? 180 : 1800,
    remake,
    participants: [...mine, ...others],
    teams: [],
    goldAt15: null,
  };
}

describe("coéquipiers fréquents", () => {
  const me = (team = 100) => p("ME", team);

  it("compte les parties et victoires ensemble, dans la même équipe seulement", () => {
    const ms = [
      match("1", 100, [me(), p("DUO", 100, { champion: "Jinx" })], [p("ENNEMI", 200)]),
      match("2", 200, [me(), p("DUO", 100, { champion: "Jinx", win: false })]),
      match("3", 300, [me(), p("DUO", 100, { champion: "Lulu" }), p("AUTRE", 100)]),
    ];
    const out = frequentTeammates(ms, "ME");
    expect(out).toHaveLength(1); // AUTRE : 1 partie < min, ENNEMI : équipe adverse
    expect(out[0]).toMatchObject({ id: "duo#test", riotId: "DUO#TEST", games: 3, wins: 2, champion: "Jinx" });
  });

  it("garde le Riot ID le plus récent et ignore remakes et identités vides", () => {
    const ms = [
      match("1", 100, [me(), p("X", 100, { gameName: "AncienNom" })]),
      match("2", 300, [me(), p("X", 100, { gameName: "NouveauNom" })]),
      match("3", 200, [me(), p("X", 100)], [], true), // remake : ignoré
      match("4", 400, [me(), p("Y", 100, { gameName: "" }), p("X", 100, { gameName: "NouveauNom" })]),
    ];
    const out = frequentTeammates(ms, "ME", 2);
    expect(out).toHaveLength(1);
    // Renommage suivi par l'identifiant interne : les 3 parties restent sur la même personne.
    expect(out[0].riotId).toBe("NouveauNom#TEST");
    expect(out[0].games).toBe(3);
  });

  it("réunit la même personne quand les identifiants internes diffèrent", () => {
    // Parties Riot (PUUID de l'API) et parties lues dans le client League (identifiants
    // internes) : seul le Riot ID est commun aux deux sources.
    const ms = [
      match("api1", 100, [me(), p("API-AMI", 100, { gameName: "Ami" })]),
      match("api2", 200, [me(), p("API-AMI", 100, { gameName: "Ami" })]),
      match("lcu1", 300, [p("ME", 100), p("11111111-2222-3333-4444-555555555555", 100, { gameName: "Ami" })]),
    ];
    const out = frequentTeammates(ms, "ME");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "ami#test", riotId: "Ami#TEST", games: 3, wins: 3 });
  });

  it("n'inscrit jamais le joueur lui-même, quel que soit son identifiant interne", () => {
    // Dans une partie du client, le joueur peut porter un autre identifiant interne.
    const moi = p("AUTRE-ID-INTERNE", 100, { gameName: "ME" });
    const ms = [match("1", 100, [me(), p("X", 100)]), match("2", 200, [me(), p("X", 100), moi])];
    expect(frequentTeammates(ms, "ME").map((t) => t.riotId)).toEqual(["X#TEST"]);
  });

  it("trie par parties communes puis victoires, et limite la liste", () => {
    const duo = (n: string, wins: number, games: number, start: number) =>
      Array.from({ length: games }, (_, i) => match(`${n}${i}`, start + i, [me(i < wins ? 100 : 200), p(n, i < wins ? 100 : 200)]));
    const ms = [...duo("A", 2, 3, 0), ...duo("B", 3, 3, 100), ...duo("C", 1, 2, 200)];
    const out = frequentTeammates(ms, "ME", 2, 2);
    expect(out.map((t) => t.riotId)).toEqual(["B#TEST", "A#TEST"]);
  });

  it("liste vide quand le joueur est absent des parties", () => {
    expect(frequentTeammates([match("1", 0, [p("X", 100)])], "ME")).toEqual([]);
  });
});
