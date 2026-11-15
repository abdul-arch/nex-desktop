// @ts-expect-error le projet n'installe pas @types/node (meme contournement que vite.config.ts)
import { readFileSync } from "node:fs";
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

// Les images de l'application viennent de serveurs distants, et la WebView n'en accepte
// que ceux listes par la CSP de `tauri.conf.json`. Un hote absent de cette liste se charge
// parfaitement dans un navigateur et ne s'affiche pas dans l'application : c'est exactement
// ce qui est arrive au fond de l'ecran d'accueil, servi par `cdn.communitydragon.org` alors
// que seul `raw.` est autorise. L'apercu navigateur, sans CSP, ne reproduisait pas la
// surface reelle — d'ou ce garde, qui lit les deux vrais fichiers.

/** Origines autorisees par `img-src`, lues dans la configuration Tauri. */
function originesAutorisees(): string[] {
  const brut: string = readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
  const conf = JSON.parse(brut);
  const img: string | undefined = conf?.app?.security?.csp?.["img-src"];
  if (!img) throw new Error("img-src introuvable dans la CSP : le test ne garde plus rien");
  return img.split(/\s+/).filter((s: string) => s.startsWith("http"));
}

/** Origines effectivement ecrites dans `assets.ts`. */
function originesUtilisees(): string[] {
  const src: string = readFileSync(new URL("./assets.ts", import.meta.url), "utf8");
  const trouvees = [...src.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]);
  return [...new Set(trouvees)];
}

describe("CSP : chaque serveur d'images est autorise par la WebView", () => {
  it("lit bien les deux fichiers", () => {
    expect(originesAutorisees().length).toBeGreaterThan(0);
    expect(originesUtilisees().length).toBeGreaterThan(0);
  });

  it("n'utilise aucun hote absent de img-src", () => {
    const autorisees = originesAutorisees();
    const refusees = originesUtilisees().filter((o) => !autorisees.includes(o));
    expect(refusees, `hote(s) hors CSP, invisibles dans l'application : ${refusees.join(", ")}`).toEqual([]);
  });

  it("aurait attrape l'hote fautif", () => {
    // Garde du garde : `cdn.communitydragon.org` repond bien, mais la CSP ne l'autorise pas.
    // Si ce test echoue un jour, c'est que l'hote a ete ajoute a img-src — alors le
    // commentaire ci-dessus est a reecrire, pas l'assertion a supprimer.
    expect(originesAutorisees()).not.toContain("https://cdn.communitydragon.org");
  });
});
