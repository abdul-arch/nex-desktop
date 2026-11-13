import { describe, expect, it } from "vitest";
import { rankValue, samplePlayer } from "./playerSample";
import type { MatchSummary } from "./types";

function m(extra: Partial<MatchSummary> = {}): MatchSummary {
  return {
    id: Math.random().toString(36),
    queue: "solo",
    champion: "Ahri",
    championLevel: 16,
    role: "MIDDLE",
    win: true,
    remake: false,
    startedAt: 0,
    durationSec: 1800,
    kills: 5,
    deaths: 2,
    assists: 5,
    cs: 200,
    teamKills: 20,
    damageToChampions: 20000,
    teamDamageToChampions: 80000,
    visionScore: 20,
    soloKills: null,
    goldDiffAt15: null,
    lpDelta: null,
    ...extra,
  };
}

describe("échantillon d'un joueur", () => {
  it("rôle principal, part, KDA et champions les plus joués", () => {
    const s = samplePlayer([
      ...Array.from({ length: 6 }, () => m()),
      ...Array.from({ length: 2 }, () => m({ role: "TOP", champion: "Garen" })),
      m({ remake: true, champion: "Zed" }),
    ]);
    expect(s.games).toBe(8);
    expect(s.role).toBe("MIDDLE");
    expect(s.roleShare).toBeCloseTo(0.75);
    expect(s.kda).toBeCloseTo(5); // (40 + 40) / 16
    expect(s.champions).toEqual([
      { champion: "Ahri", games: 6 },
      { champion: "Garen", games: 2 },
    ]);
  });

  it("pas de rôle annoncé avec un historique insuffisant, rien d'inventé sans partie", () => {
    const few = samplePlayer([m(), m(), m()]);
    expect(few.role).toBeNull();
    expect(few.roleShare).toBeNull();
    expect(few.kda).not.toBeNull();
    const none = samplePlayer([]);
    expect(none).toEqual({ games: 0, role: null, roleShare: null, kda: null, champions: [] });
  });
});

describe("hiérarchie des rangs", () => {
  it("palier, puis division, puis LP", () => {
    const master = rankValue({ tier: "MASTER", division: "I", lp: 0 });
    const diamond = rankValue({ tier: "DIAMOND", division: "I", lp: 99 });
    expect(master).toBeGreaterThan(diamond);
    expect(rankValue({ tier: "GOLD", division: "I", lp: 0 })).toBeGreaterThan(rankValue({ tier: "GOLD", division: "II", lp: 90 }));
    expect(rankValue({ tier: "CHALLENGER", division: null, lp: 900 })).toBeGreaterThan(rankValue({ tier: "GRANDMASTER", division: null, lp: 1500 }));
    expect(rankValue(null)).toBe(-1);
    expect(rankValue({ tier: "INCONNU", division: null, lp: 10 })).toBe(-1);
  });
});
