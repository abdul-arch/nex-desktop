import { describe, expect, it } from "vitest";
import { METRICS, championAggregates, isCountable, kdaOf, roleDistribution, summarize } from "./metrics";
import { nexScore } from "./nexScore";
import type { MatchSummary } from "./types";

let n = 0;
function match(p: Partial<MatchSummary> = {}): MatchSummary {
  n++;
  return {
    id: `T${n}`,
    queue: "solo",
    champion: "Ahri",
    championLevel: 16,
    role: "MIDDLE",
    win: true,
    remake: false,
    startedAt: 1_000_000 - n,
    durationSec: 1800,
    kills: 5,
    deaths: 2,
    assists: 5,
    cs: 210,
    teamKills: 20,
    damageToChampions: 18000,
    teamDamageToChampions: 72000,
    visionScore: 20,
    soloKills: 1,
    goldDiffAt15: 300,
    lpDelta: 20,
    ...p,
  };
}
const metric = (k: string) => METRICS.find((m) => m.key === k)!;

describe("métriques", () => {
  it("KDA : ratio de sommes, 0 mort divisé par 1", () => {
    expect(kdaOf(3, 0, 4)).toBe(7);
    const ms = [match({ kills: 10, deaths: 0, assists: 0 }), match({ kills: 0, deaths: 5, assists: 0 })];
    // (10+0)/(0+5) = 2, et non la moyenne des ratios (10+0)/2 = 5
    expect(metric("kda").aggregate(ms)).toBe(2);
  });

  it("exclut remakes et durées invalides", () => {
    expect(isCountable(match({ remake: true }))).toBe(false);
    expect(isCountable(match({ durationSec: 120 }))).toBe(false);
    expect(isCountable(match({ durationSec: Number.NaN }))).toBe(false);
    expect(isCountable(match({ queue: "other" }))).toBe(false);
    expect(isCountable(match({ queue: "aram" }))).toBe(true);
    const s = summarize(metric("csPerMin"), [match({ remake: true, cs: 999, durationSec: 200 }), match()]);
    expect(s.sampleSize).toBe(1);
    expect(s.value).toBeCloseTo(7, 5);
  });

  it("participation : null si l'équipe n'a aucune élimination", () => {
    expect(metric("killParticipation").aggregate([match({ teamKills: 0, kills: 0, assists: 0 })])).toBeNull();
  });

  it("écart d'or @15 : moyenne des seules parties avec timeline", () => {
    const s = summarize(metric("goldDiffAt15"), [match({ goldDiffAt15: 400 }), match({ goldDiffAt15: null }), match({ goldDiffAt15: -200 })]);
    expect(s.value).toBe(100);
    expect(s.sampleSize).toBe(2);
  });

  it("variation : null si moins de 3 parties par bloc", () => {
    const s = summarize(metric("kda"), [match(), match(), match(), match()], 3);
    expect(s.delta).toBeNull();
  });

  it("variation en points pour les pourcentages", () => {
    const recent = Array.from({ length: 3 }, () => match({ kills: 6, assists: 6, teamKills: 20 })); // 60 %
    const older = Array.from({ length: 3 }, () => match({ kills: 5, assists: 5, teamKills: 20 })); // 50 %
    const s = summarize(metric("killParticipation"), [...recent, ...older], 3);
    expect(s.delta).toBeCloseTo(10, 5);
  });

  it("agrégats champions et rôles", () => {
    const ms = [match({ champion: "Ahri" }), match({ champion: "Ahri", win: false }), match({ champion: "Azir", role: "TOP" })];
    const c = championAggregates(ms);
    expect(c[0]).toMatchObject({ champion: "Ahri", games: 2, wins: 1 });
    const roles = roleDistribution(ms);
    expect(roles.find((r) => r.role === "MIDDLE")?.share).toBeCloseTo(2 / 3, 5);
  });
});

describe("score NEX", () => {
  it("vaut 50 au niveau exact des repères et reste borné", () => {
    const atBaseline = match({
      role: "MIDDLE",
      durationSec: 1800,
      kills: 14,
      deaths: 5,
      assists: 0, // KDA 2.8
      teamKills: 27, // KP 14/27 ≈ 0.5185 (repère 0.52)
      cs: 216, // 7.2/min
      damageToChampions: 25000,
      teamDamageToChampions: 100000, // 25 %
      visionScore: 19.5, // 0.65/min
    });
    expect(nexScore(atBaseline).score!).toBeCloseTo(50, 0);
    const huge = nexScore(match({ kills: 40, deaths: 0, assists: 40, teamKills: 80, cs: 400, damageToChampions: 70000, visionScore: 90 }));
    expect(huge.score).toBeLessThanOrEqual(100);
    const awful = nexScore(match({ kills: 0, deaths: 15, assists: 0, cs: 20, damageToChampions: 100, visionScore: 0 }));
    expect(awful.score).toBeGreaterThanOrEqual(0);
  });

  it("indisponible pour un remake", () => {
    expect(nexScore(match({ remake: true })).score).toBeNull();
  });

  it("pas de note en ARAM : les repères valent pour la Faille", () => {
    // Une partie ARAM typique (peu de sbires, aucune vision) ne doit pas être jugée « faible ».
    const aram = nexScore(match({ queue: "aram", role: null, cs: 60, visionScore: 0, kills: 12, deaths: 9, assists: 25 }));
    expect(aram.score).toBeNull();
    expect(aram.components).toEqual([]);
    expect(nexScore(match({ queue: "aram", mayhem: true })).score).toBeNull();
  });
});
