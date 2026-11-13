import { describe, expect, it } from "vitest";
import { spellIcon } from "./assets";

const V = "16.22.1";

describe("spellIcon", () => {
  it("accepte un nom sans extension (catalogue des sorts d'invocateur)", () => {
    expect(spellIcon(V, "SummonerFlash")).toBe(`https://ddragon.leagueoflegends.com/cdn/${V}/img/spell/SummonerFlash.png`);
  });

  it("accepte un nom avec extension (fiche de champion) sans la doubler", () => {
    expect(spellIcon(V, "AhriW.png")).toBe(`https://ddragon.leagueoflegends.com/cdn/${V}/img/spell/AhriW.png`);
  });

  it("refuse ce qui n'est pas un nom simple", () => {
    expect(spellIcon(V, "../../etc/passwd")).toBeNull();
    expect(spellIcon(V, "a/b.png")).toBeNull();
    expect(spellIcon(V, ".png")).toBeNull();
    expect(spellIcon(V, "")).toBeNull();
    expect(spellIcon(V, undefined)).toBeNull();
  });

  it("refuse une version invalide", () => {
    expect(spellIcon("16.22", "AhriW.png")).toBeNull();
    expect(spellIcon(null, "AhriW.png")).toBeNull();
  });
});
