import { describe, expect, it } from "vitest";
import { dayLabel, groupByDay, lastSession, sessions, type Playable } from "./sessions";

const H = 3_600_000;
/** 12 novembre 2026, 20:00 heure locale. */
const base = new Date(2026, 10, 12, 20, 0, 0).getTime();

const m = (id: string, startedAt: number, over: Partial<Playable> = {}): Playable => ({
  id,
  startedAt,
  durationSec: 1800,
  win: true,
  remake: false,
  ...over,
});

describe("sessions", () => {
  it("coupe au-delà de deux heures entre deux parties", () => {
    const a = m("a", base);
    const b = m("b", base + 0.75 * H); // 15 min après la fin de a
    const c = m("c", base + 5 * H); // bien plus tard : nouvelle session
    const out = sessions([a, b, c]);
    expect(out).toHaveLength(2);
    // La plus récente d'abord.
    expect(out[0].matches.map((x) => x.id)).toEqual(["c"]);
    expect(out[1].matches.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("mesure l'écart depuis la FIN de la partie précédente", () => {
    // Une partie de 45 min suivie 1 h 30 après son début : l'écart réel est de 45 min.
    const longue = m("longue", base, { durationSec: 45 * 60 });
    const suivante = m("suivante", base + 1.5 * H);
    expect(sessions([longue, suivante])).toHaveLength(1);
  });

  it("compte les victoires, les défaites et le temps de jeu", () => {
    const out = lastSession([m("a", base, { win: true }), m("b", base + H, { win: false }), m("c", base + 2 * H, { win: true })])!;
    expect([out.games, out.wins, out.losses]).toEqual([3, 2, 1]);
    expect(out.durationSec).toBe(3 * 1800);
    expect(out.endedAt).toBe(base + 2 * H + 1800 * 1000);
  });

  it("ne compte pas un remake dans le bilan, mais le garde dans la session", () => {
    const out = lastSession([m("a", base, { win: true }), m("r", base + H, { remake: true, win: false })])!;
    expect(out.games).toBe(2);
    expect(out.wins + out.losses).toBe(1);
  });

  it("additionne les LP connus et rend null quand aucun ne l'est", () => {
    const avec = lastSession([m("a", base, { lpDelta: 22 }), m("b", base + H, { lpDelta: -18 })])!;
    expect(avec.lpDelta).toBe(4);
    expect(lastSession([m("a", base)])!.lpDelta).toBeNull();
    // Une seule variation connue sur deux parties : on somme ce qu'on sait.
    expect(lastSession([m("a", base, { lpDelta: 22 }), m("b", base + H)])!.lpDelta).toBe(22);
  });

  it("rend null sans aucune partie", () => {
    expect(lastSession([])).toBeNull();
    expect(sessions([])).toEqual([]);
  });
});

describe("groupByDay", () => {
  it("range chaque partie au jour de son début, du plus récent au plus ancien", () => {
    const hier = new Date(2026, 10, 11, 22, 0, 0).getTime();
    const out = groupByDay([m("a", base), m("b", hier), m("c", base + H)], base);
    expect(out.map((g) => g.label)).toEqual(["Aujourd'hui", "Hier"]);
    expect(out[0].matches.map((x) => x.id)).toEqual(["c", "a"]);
    expect(out[0].games).toBe(2);
  });

  it("nomme les jours plus anciens en toutes lettres", () => {
    const vieux = new Date(2026, 10, 8, 21, 0, 0).getTime();
    const out = groupByDay([m("a", vieux)], base);
    expect(out[0].label).toBe("dimanche 8 novembre");
  });

  it("donne le bilan du jour", () => {
    const out = groupByDay([m("a", base, { win: true, lpDelta: 30 }), m("b", base + H, { win: false, lpDelta: -13 })], base);
    expect([out[0].wins, out[0].losses, out[0].lpDelta]).toEqual([1, 1, 17]);
  });
});

describe("dayLabel", () => {
  it("distingue aujourd'hui, hier et le reste", () => {
    const today = new Date(2026, 10, 12, 0, 0, 0).getTime();
    expect(dayLabel(today, base)).toBe("Aujourd'hui");
    expect(dayLabel(today - 86_400_000, base)).toBe("Hier");
    expect(dayLabel(new Date(2026, 10, 9, 0, 0, 0).getTime(), base)).toBe("lundi 9 novembre");
  });
});
