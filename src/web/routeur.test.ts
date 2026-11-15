import { describe, expect, it } from "vitest";
import { locationDepuisUrl, titreDe, urlDepuisLocation } from "./routeur";

describe("routeur du site", () => {
  it("fait l'aller-retour d'un profil, espaces et tirets dans le nom compris", () => {
    const loc = { route: "profile" as const, params: { riotId: "Katsuki Sama#EUW", platform: "EUW1" } };
    const url = urlDepuisLocation(loc);
    expect(url).toBe("/joueur/euw1/Katsuki%20Sama-EUW");
    expect(locationDepuisUrl("/joueur/euw1/Katsuki%20Sama-EUW", "")).toEqual(loc);

    // Un nom avec tiret : seul le DERNIER separe le tag.
    const avecTiret = { route: "profile" as const, params: { riotId: "Jean-Michel#1234", platform: "KR" } };
    const u2 = urlDepuisLocation(avecTiret);
    expect(locationDepuisUrl(u2, "")).toEqual(avecTiret);
  });

  it("refuse un profil sans tag ou sans plateforme plutot que d'en inventer un", () => {
    expect(locationDepuisUrl("/joueur/euw1/SansTag", "").route).toBe("accueil");
    expect(locationDepuisUrl("/joueur//Nom-TAG", "").route).toBe("accueil");
    expect(locationDepuisUrl("/joueur/euw1/Nom-", "").route).toBe("accueil");
    expect(urlDepuisLocation({ route: "profile", params: { riotId: "sans-diese" } })).toBe("/");
  });

  it("distingue la tier list d'une fiche de champion, avec le poste", () => {
    expect(urlDepuisLocation({ route: "champions" })).toBe("/champions");
    expect(urlDepuisLocation({ route: "champions", params: { champion: "Vayne", role: "BOTTOM" } })).toBe("/champion/Vayne?role=BOTTOM");
    expect(locationDepuisUrl("/champion/Vayne", "?role=BOTTOM")).toEqual({ route: "champions", params: { champion: "Vayne", role: "BOTTOM" } });
    expect(locationDepuisUrl("/champions", "")).toEqual({ route: "champions", params: undefined });
  });

  it("renvoie a l'accueil ce qu'il ne connait pas", () => {
    expect(locationDepuisUrl("/", "").route).toBe("accueil");
    expect(locationDepuisUrl("/n-importe/quoi", "").route).toBe("accueil");
    expect(locationDepuisUrl("/joueur/euw1/%E0%A4%A", "").route).toBe("accueil");
  });

  it("donne un titre d'onglet qui dit ou l'on est", () => {
    expect(titreDe({ route: "profile", params: { riotId: "Katsuki Sama#EUW" } })).toContain("Katsuki Sama#EUW");
    expect(titreDe({ route: "champions", params: { champion: "Vayne" } })).toContain("Vayne");
    expect(titreDe({ route: "accueil" as never })).toContain("NEX");
  });
});
