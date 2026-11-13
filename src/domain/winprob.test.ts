import { describe, expect, it } from "vitest";
import type { WinProbDto } from "../platform/api";
import { bucketOf, nearestMinute, winProbability } from "./winprob";

const grid: WinProbDto = {
  cells: [
    { minute: 15, bucket: 0, games: 400, wins: 200 },
    { minute: 15, bucket: 2, games: 120, wins: 82 },
    { minute: 15, bucket: -2, games: 120, wins: 38 },
    { minute: 20, bucket: 3, games: 90, wins: 72 },
  ],
  observations: 3807,
  minGames: 60,
  maxBucket: 10,
};

describe("nearestMinute", () => {
  it("prend la tranche la plus proche", () => {
    expect(nearestMinute(15 * 60)).toBe(15);
    expect(nearestMinute(16 * 60)).toBe(15);
    expect(nearestMinute(18 * 60)).toBe(20);
  });

  it("refuse au-dela de la tolerance", () => {
    // 37:30 est a 2:30 de la tranche 35 : accepte. 38:00 ne l'est plus.
    expect(nearestMinute(37.5 * 60)).toBe(35);
    expect(nearestMinute(38 * 60)).toBeNull();
    expect(nearestMinute(60)).toBeNull();
  });
});

describe("bucketOf", () => {
  it("arrondit au millier et borne", () => {
    expect(bucketOf(0, 10)).toBe(0);
    expect(bucketOf(2400, 10)).toBe(2);
    expect(bucketOf(-2600, 10)).toBe(-3);
    expect(bucketOf(99_000, 10)).toBe(10);
    expect(bucketOf(-99_000, 10)).toBe(-10);
  });
});

describe("winProbability", () => {
  it("lit la case correspondante", () => {
    const a = winProbability(grid, 15 * 60, 2100)!;
    expect(a.p).toBeCloseTo(82 / 120, 5);
    expect(a.games).toBe(120);
    expect(a.bucket).toBe(2);
  });

  it("une case absente ne donne aucune reponse, sans repli sur la voisine", () => {
    // La case (15, +4) n'existe pas : pas assez observee.
    expect(winProbability(grid, 15 * 60, 4000)).toBeNull();
  });

  it("hors de la plage de temps couverte, aucune reponse", () => {
    expect(winProbability(grid, 45 * 60, 0)).toBeNull();
  });

  it("grille vide ou absente", () => {
    expect(winProbability(null, 15 * 60, 0)).toBeNull();
    expect(winProbability({ ...grid, cells: [] }, 15 * 60, 0)).toBeNull();
  });

  it("l'ecart estime choisit la case par arrondi au millier", () => {
    // 1600 arrondit a 2, pas a 1 : la case (15, +1) n'existe pas et donnerait null.
    expect(winProbability(grid, 15 * 60, 1600)?.bucket).toBe(2);
    expect(winProbability(grid, 15 * 60, 1400)).toBeNull();
  });
});
