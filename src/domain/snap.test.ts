import { describe, expect, it } from "vitest";
import { SNAP_RANGE, snapAxis, snapPoint } from "./snap";

describe("snapAxis", () => {
  it("attire vers le bord et l'axe central", () => {
    expect(snapAxis(0.004)).toBe(0);
    expect(snapAxis(0.497)).toBe(0.5);
    expect(snapAxis(0.995)).toBe(1);
  });

  it("laisse la valeur intacte hors de portée", () => {
    expect(snapAxis(0.3)).toBe(0.3);
    expect(snapAxis(0.5 + SNAP_RANGE)).toBe(0.5 + SNAP_RANGE);
  });

  it("s'aligne aussi sur les autres widgets", () => {
    expect(snapAxis(0.302, [0.3])).toBe(0.3);
  });

  it("choisit le repère le plus proche quand deux sont à portée", () => {
    // 0,503 est à 0,003 de l'axe central et à 0,005 d'un autre widget.
    expect(snapAxis(0.503, [0.508])).toBe(0.5);
    expect(snapAxis(0.507, [0.508])).toBe(0.508);
  });
});

describe("snapPoint", () => {
  it("aimante les deux axes", () => {
    expect(snapPoint({ x: 0.003, y: 0.498 }, [], true)).toEqual({ x: 0, y: 0.5 });
  });

  it("désactivé, rend le point tel quel", () => {
    const p = { x: 0.003, y: 0.498 };
    expect(snapPoint(p, [], false)).toEqual(p);
  });

  it("un axe peut s'aligner sans l'autre", () => {
    expect(snapPoint({ x: 0.004, y: 0.31 }, [], true)).toEqual({ x: 0, y: 0.31 });
  });
});
