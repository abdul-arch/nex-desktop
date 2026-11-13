import { describe, expect, it } from "vitest";
import type { ChampionStatDto, MatchupDto, MatchupsDto } from "../../platform/api";
import { layout } from "./DistributionChart";
import { composition, suggest } from "./draftLogic";

const stat = (id: number, games: number, adj: number): ChampionStatDto => ({
  championId: id,
  position: "MIDDLE",
  games,
  wins: Math.round(games * adj),
  pickRate: 0.1,
  banRate: 0,
  adjustedWinRate: adj,
  tier: "A",
});

const mu = (id: number, delta: number, games = 20): MatchupDto => ({ opponentId: id, games, wins: 10, winRate: 0.5, deltaPp: delta });

describe("suggestions de draft", () => {
  const tier = [stat(1, 100, 0.52), stat(2, 100, 0.51), stat(3, 5, 0.6), stat(4, 100, 0.5)];

  it("exclut les champions pris et les petits échantillons", () => {
    const s = suggest(tier, null, new Set([1]), 20, String);
    expect(s.map((x) => x.championId)).toEqual([2, 4]);
  });

  it("l'avantage de ligne vient des matchups de l'adversaire, pondéré par l'effectif", () => {
    const enemy: MatchupsDto = {
      scope: { patch: "16.22", platform: "all", queueId: 420, tier: "all", matches: 100 },
      championId: 99,
      position: "MIDDLE",
      games: 100,
      wins: 50,
      averageWinRate: 0.5,
      matchups: [mu(4, -10, 30)], // l'ennemi perd 10 pts contre le champion 4
    };
    const s = suggest(tier, enemy, new Set(), 20, (id) => `C${id}`);
    expect(s[0].championId).toBe(4);
    expect(s[0].laneAdvantage).toEqual({ pp: 10, games: 30 });
    expect(s[0].reasons[1]).toContain("C99");
  });
});

describe("profil de composition", () => {
  it("signale une équipe très physique et sans tank", () => {
    const team = Array.from({ length: 5 }, () => ({ attack: 9, magic: 1, tags: ["Marksman"] }));
    const p = composition(team);
    expect(p.physicalShare).toBeCloseTo(0.9);
    expect(p.frontline).toBe(0);
    expect(p.notes.length).toBe(2);
  });
  it("équipe vide : aucune conclusion", () => {
    expect(composition([]).physicalShare).toBeNull();
  });
});

describe("distribution des matchups", () => {
  it("aucun chevauchement sur une même rangée", () => {
    const items = Array.from({ length: 40 }, (_, i) => mu(i, (i % 7) - 3 + i * 0.01));
    const placed = layout(items, (d) => (d + 10) * 50, 30);
    for (const a of placed)
      for (const b of placed) if (a !== b && a.row === b.row) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(32);
    // L'abscisse ne dépend que de l'écart : même écart => même x.
    const same = placed.filter((p) => p.m.deltaPp === placed[0].m.deltaPp);
    expect(new Set(same.map((p) => p.x)).size).toBe(1);
  });
});
