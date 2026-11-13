import { describe, expect, it } from "vitest";
import type { LivePlayer } from "../platform/api";
import { GOLD_PER_KILL, GOLD_PER_MINION, GOLD_PER_MONSTER, PASSIVE_PER_SEC, START_GOLD, kdiff, kgold, playerGold, teamGold } from "./livegold";

const player = (over: Partial<LivePlayer> = {}): LivePlayer => ({
  riotId: "Joueur#EUW",
  championKey: "Ahri",
  team: "ORDER",
  position: "MIDDLE",
  level: 1,
  kills: 0,
  deaths: 0,
  assists: 0,
  cs: 0,
  items: [],
  isDead: false,
  respawnTimer: 0,
  isActive: false,
  ...over,
});

describe("playerGold", () => {
  it("avant 1:50, seul l'or de depart compte", () => {
    expect(playerGold(player(), 60)).toBe(START_GOLD);
  });

  it("l'or passif demarre a 1:50", () => {
    // 10 s de passif apres 110 s.
    expect(playerGold(player(), 120)).toBeCloseTo(START_GOLD + 10 * PASSIVE_PER_SEC, 5);
  });

  it("les sbires et les eliminations s'ajoutent", () => {
    const p = player({ cs: 100, kills: 2, assists: 4 });
    expect(playerGold(p, 110)).toBe(START_GOLD + 100 * GOLD_PER_MINION + 2 * GOLD_PER_KILL + 4 * 150);
  });

  it("la jungle est comptee a un taux different des voies", () => {
    const jg = player({ position: "JUNGLE", cs: 50 });
    const mid = player({ position: "MIDDLE", cs: 50 });
    expect(playerGold(jg, 110) - playerGold(mid, 110)).toBe(50 * (GOLD_PER_MONSTER - GOLD_PER_MINION));
  });
});

describe("teamGold", () => {
  it("separe les deux equipes du point de vue du joueur actif", () => {
    const players = [
      player({ isActive: true, team: "ORDER", cs: 100 }),
      player({ team: "ORDER", cs: 50 }),
      player({ team: "CHAOS", cs: 60 }),
      player({ team: "CHAOS", cs: 40 }),
    ];
    const g = teamGold(players, 110)!;
    expect(g.mine).toBe(2 * START_GOLD + 150 * GOLD_PER_MINION);
    expect(g.theirs).toBe(2 * START_GOLD + 100 * GOLD_PER_MINION);
    expect(g.diff).toBe(50 * GOLD_PER_MINION);
  });

  it("l'or de depart et l'or passif s'annulent dans l'ecart", () => {
    const even = [
      player({ isActive: true, team: "ORDER", cs: 80 }),
      player({ team: "CHAOS", cs: 80 }),
    ];
    // Quel que soit le temps de jeu, deux joueurs a egalite de CS ont un ecart nul.
    expect(teamGold(even, 110)!.diff).toBe(0);
    expect(teamGold(even, 1800)!.diff).toBe(0);
  });

  it("null en spectateur : aucun joueur actif", () => {
    expect(teamGold([player({ team: "ORDER" }), player({ team: "CHAOS" })], 600)).toBeNull();
  });

  it("null si une seule equipe est presente", () => {
    expect(teamGold([player({ isActive: true, team: "ORDER" })], 600)).toBeNull();
  });
});

describe("mise en forme", () => {
  it("kgold", () => {
    expect(kgold(0)).toBe("0");
    expect(kgold(940)).toBe("940");
    expect(kgold(24_149)).toBe("24.1K");
  });

  it("kdiff arrondit a la centaine et porte le signe", () => {
    expect(kdiff(4030)).toBe("+4.0K");
    expect(kdiff(-820)).toBe("-800");
    expect(kdiff(40)).toBe("0");
  });
});
