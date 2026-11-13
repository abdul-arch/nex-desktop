import { describe, expect, it } from "vitest";
import { parseRiotId } from "./riotId";

describe("Riot ID", () => {
  it("accepte Pseudo#TAG (y compris Unicode) et coupe au dernier #", () => {
    expect(parseRiotId(" Faker#KR1 ")).toEqual({ ok: true, value: { gameName: "Faker", tagLine: "KR1" } });
    expect(parseRiotId("Élodie Ça#EUW").ok).toBe(true);
  });
  it("refuse les formats invalides (mêmes règles que Rust)", () => {
    for (const bad of ["NoTag", "ab#EUW", "Player#E", "Player#EU-W", "A#B#EUW", "NomBeaucoupTropLong#EUW"]) {
      expect(parseRiotId(bad).ok, bad).toBe(false);
    }
  });
});
