import { describe, expect, it } from "vitest";
import type { SkinEntry, SkinInventory } from "../platform/api";
import { groupKey, summarize, viewSkins } from "./skins";

const skins: SkinEntry[] = [
  { id: 103027, championId: 103, num: 27, name: "A", rarity: "epic", legacy: false, lines: [120] },
  { id: 103086, championId: 103, num: 86, name: "B", rarity: "mythic", legacy: true, lines: [] },
  { id: 238001, championId: 238, num: 1, name: "C", rarity: "legendary", legacy: false, lines: [] },
];

describe("collection", () => {
  it("sans inventaire, l'état est inconnu (jamais « manquant »)", () => {
    const v = viewSkins(skins, null);
    expect(v.every((s) => s.state === "unknown")).toBe(true);
    expect(groupKey(v[0], "year", String, String)).toBe("Possession inconnue");
    expect(summarize(v).owned).toBe(0);
  });

  it("valeur estimée : seulement les raretés à prix connu", () => {
    const inv: SkinInventory = { source: "client", fetchedAt: 1, owned: [{ id: 103027, acquiredAt: Date.UTC(2024, 0, 1) }, { id: 103086, acquiredAt: null }], unobtainable: [103086], obtainableKnown: true };
    const v = viewSkins(skins, inv);
    const s = summarize(v);
    expect(s.owned).toBe(2);
    expect(s.estimatedRp).toBe(1350);
    expect(s.ownedWithoutPrice).toBe(1);
    expect(v.find((x) => x.id === 238001)?.state).toBe("missing");
    expect(v.find((x) => x.id === 103086)?.obtainable).toBe(false);
    expect(groupKey(v[0], "year", String, String)).toBe("Acquis en 2024");
    expect(groupKey(v[1], "year", String, String)).toBe("Date d'acquisition inconnue");
    expect(groupKey(v[2], "year", String, String)).toBe("Non possédés");
  });
});
