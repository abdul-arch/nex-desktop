import { describe, expect, it } from "vitest";
import { countValue, digitsOf, easeOutCubic } from "./countUp";

describe("easeOutCubic", () => {
  it("part de 0 et finit a 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("borne les entrees hors de [0,1]", () => {
    expect(easeOutCubic(-5)).toBe(0);
    expect(easeOutCubic(9)).toBe(1);
  });

  it("avance plus vite au debut qu'a la fin", () => {
    const debut = easeOutCubic(0.2) - easeOutCubic(0);
    const fin = easeOutCubic(1) - easeOutCubic(0.8);
    expect(debut).toBeGreaterThan(fin);
  });
});

describe("countValue", () => {
  it("part de 0 et tombe exactement sur la cible", () => {
    expect(countValue(90, 0, 900)).toBe(0);
    expect(countValue(90, 900, 900)).toBe(90);
    expect(countValue(90, 5000, 900)).toBe(90);
  });

  it("ne depasse jamais la cible", () => {
    for (let t = 0; t <= 900; t += 5) {
      expect(countValue(90, t, 900)).toBeLessThanOrEqual(90);
    }
  });

  it("ne redescend jamais", () => {
    let precedent = 0;
    for (let t = 0; t <= 900; t += 7) {
      const v = countValue(1200, t, 900);
      expect(v).toBeGreaterThanOrEqual(precedent);
      precedent = v;
    }
  });

  it("met le meme temps quelle que soit la cible", () => {
    // Une cible de 1200 n'est pas plus longue qu'une cible de 9 : seule la valeur change.
    expect(countValue(9, 450, 900)).toBe(countValue(9, 450, 900));
    expect(countValue(1200, 900, 900)).toBe(1200);
    expect(countValue(9, 900, 900)).toBe(9);
  });

  it("gere les valeurs limites du cahier des charges", () => {
    for (const cible of [0, 9, 90, 100, 1200]) {
      expect(countValue(cible, 0, 900)).toBe(0);
      expect(countValue(cible, 900, 900)).toBe(cible);
    }
  });

  it("rend la cible sans animation quand la duree est nulle", () => {
    // Cas « reduire les animations » : la valeur finale tout de suite.
    expect(countValue(90, 0, 0)).toBe(90);
  });

  it("ne renvoie pas NaN sur une entree invalide", () => {
    expect(countValue(Number.NaN, 100, 900)).toBe(0);
  });
});

describe("digitsOf", () => {
  it("compte les chiffres de la cible", () => {
    expect(digitsOf(0)).toBe(1);
    expect(digitsOf(9)).toBe(1);
    expect(digitsOf(90)).toBe(2);
    expect(digitsOf(100)).toBe(3);
    expect(digitsOf(1200)).toBe(4);
  });
});
