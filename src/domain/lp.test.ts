import { describe, expect, it } from "vitest";
import type { RankSnapshotDto } from "../platform/api";
import type { MatchSummary } from "./types";
import { attributeLp, ladderPoints, lpChanges, lpSeries } from "./lp";

const snap = (at: number, tier: string, division: string | null, lp: number, queue = "RANKED_SOLO_5x5"): RankSnapshotDto => ({
  at,
  queue,
  tier,
  division,
  lp,
  wins: 0,
  losses: 0,
});

const H = 3_600_000;
const match = (id: string, startedAt: number, queue: MatchSummary["queue"] = "solo", extra: Partial<MatchSummary> = {}): MatchSummary => ({
  id,
  queue,
  champion: "Ahri",
  championLevel: 15,
  role: null,
  win: true,
  remake: false,
  startedAt,
  durationSec: 1800,
  kills: 5,
  deaths: 3,
  assists: 7,
  cs: 180,
  teamKills: 20,
  damageToChampions: 20000,
  teamDamageToChampions: 80000,
  visionScore: 20,
  soloKills: null,
  goldDiffAt15: null,
  lpDelta: null,
  ...extra,
});

describe("ladderPoints", () => {
  it("met les paliers bout à bout, divisions comprises", () => {
    expect(ladderPoints("IRON", "IV", 0)).toBe(0);
    expect(ladderPoints("IRON", "I", 0)).toBe(300);
    expect(ladderPoints("BRONZE", "IV", 0)).toBe(400);
    expect(ladderPoints("DIAMOND", "I", 95)).toBe(2795);
  });

  it("enchaîne Diamant I sur Maître sans trou", () => {
    const avant = ladderPoints("DIAMOND", "I", 95)!;
    const apres = ladderPoints("MASTER", null, 10)!;
    // Une montée de palier est un gain de 15 points, pas une chute de 85.
    expect(apres - avant).toBe(15);
  });

  it("place Grand Maître et Challenger sur la même échelle que Maître", () => {
    expect(ladderPoints("GRANDMASTER", null, 500)).toBe(ladderPoints("MASTER", null, 500));
    expect(ladderPoints("CHALLENGER", null, 1200)).toBe(ladderPoints("MASTER", null, 1200));
  });

  it("rend null sur un palier ou une division inconnus", () => {
    expect(ladderPoints("UNRANKED", null, 0)).toBeNull();
    expect(ladderPoints("GOLD", null, 50)).toBeNull();
    expect(ladderPoints("GOLD", "V", 50)).toBeNull();
  });
});

describe("lpChanges", () => {
  it("ne compte pas le premier relevé comme une variation", () => {
    expect(lpChanges([snap(1000, "GOLD", "II", 40)], "RANKED_SOLO_5x5")).toEqual([]);
  });

  it("suit les variations dans l'ordre, et ignore l'autre file", () => {
    const snaps = [
      snap(3000, "GOLD", "II", 60),
      snap(1000, "GOLD", "II", 40),
      snap(2000, "GOLD", "II", 18),
      snap(2500, "PLATINUM", "IV", 99, "RANKED_FLEX_SR"),
    ];
    expect(lpChanges(snaps, "RANKED_SOLO_5x5").map((c) => c.delta)).toEqual([-22, 42]);
  });
});

describe("lpSeries", () => {
  it("part de zéro et suit le solde, changement de palier compris", () => {
    const snaps = [snap(1000, "DIAMOND", "I", 95), snap(2000, "MASTER", null, 10), snap(3000, "MASTER", null, 40), snap(4000, "MASTER", null, 18)];
    const s = lpSeries(lpChanges(snaps, "RANKED_SOLO_5x5"))!;
    expect(s.values).toEqual([0, 15, 45, 23]);
    expect(s.net).toBe(23);
    expect(s.since).toBe(1000);
  });

  it("rend null quand il n'y a aucun changement à tracer", () => {
    expect(lpSeries([])).toBeNull();
    expect(lpSeries(lpChanges([snap(1000, "GOLD", "II", 40)], "RANKED_SOLO_5x5"))).toBeNull();
  });
});

describe("attributeLp", () => {
  it("attribue la variation à la seule partie classée de l'intervalle", () => {
    const m = match("EUW1_1", 10 * H);
    const fin = m.startedAt + m.durationSec * 1000;
    const snaps = [snap(fin - H, "GOLD", "II", 40), snap(fin + 60_000, "GOLD", "II", 62)];
    expect(attributeLp([m], snaps).get("EUW1_1")).toBe(22);
  });

  it("n'attribue rien quand deux parties tiennent dans le même intervalle", () => {
    const a = match("EUW1_1", 10 * H);
    const b = match("EUW1_2", 11 * H);
    const snaps = [snap(9 * H, "GOLD", "II", 40), snap(12 * H, "GOLD", "II", 80)];
    const out = attributeLp([a, b], snaps);
    expect(out.has("EUW1_1")).toBe(false);
    expect(out.has("EUW1_2")).toBe(false);
  });

  it("ne rattache aucune partie jouée avant le premier relevé", () => {
    const vieille = match("EUW1_vieille", 1 * H);
    const recente = match("EUW1_recente", 10 * H);
    const snaps = [snap(9 * H, "GOLD", "II", 40), snap(11 * H, "GOLD", "II", 62)];
    const out = attributeLp([vieille, recente], snaps);
    expect(out.has("EUW1_vieille")).toBe(false);
    expect(out.get("EUW1_recente")).toBe(22);
  });

  it("ne mélange pas Solo/Duo et Flex", () => {
    const flex = match("EUW1_flex", 10 * H, "flex");
    const solo = match("EUW1_solo", 10.5 * H, "solo");
    const snaps = [
      snap(9 * H, "GOLD", "II", 40),
      snap(11 * H, "GOLD", "II", 62),
      snap(9 * H, "SILVER", "I", 10, "RANKED_FLEX_SR"),
      snap(11 * H, "SILVER", "I", 35, "RANKED_FLEX_SR"),
    ];
    const out = attributeLp([flex, solo], snaps);
    expect(out.get("EUW1_solo")).toBe(22);
    expect(out.get("EUW1_flex")).toBe(25);
  });

  it("ignore les remakes et les parties non classées", () => {
    const aram = match("EUW1_aram", 10 * H, "aram");
    const remake = match("EUW1_remake", 10 * H, "solo", { remake: true });
    const snaps = [snap(9 * H, "GOLD", "II", 40), snap(11 * H, "GOLD", "II", 62)];
    const out = attributeLp([aram, remake], snaps);
    expect(out.size).toBe(0);
  });

  it("suit une montée de palier", () => {
    const m = match("EUW1_1", 10 * H);
    const snaps = [snap(9 * H, "DIAMOND", "I", 95), snap(11 * H, "MASTER", null, 10)];
    expect(attributeLp([m], snaps).get("EUW1_1")).toBe(15);
  });
});
