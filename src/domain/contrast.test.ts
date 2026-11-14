// Le test lit la vraie feuille, pas une copie de ses valeurs : c'est ce qui fait qu'il
// garde quelque chose. `?raw` aurait ete plus propre, mais le pipeline CSS de Vite
// l'intercepte et rend une chaine vide — essaye, mesure, abandonne.
// @ts-expect-error le projet n'installe pas @types/node (meme contournement que vite.config.ts)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AA_TEXTE, composer, contraste, empiler, luminance, parseHex } from "./contrast";

const hex = (s: string) => {
  const c = parseHex(s);
  if (!c) throw new Error(`couleur illisible : ${s}`);
  return c;
};

describe("parseHex", () => {
  it("lit les deux ecritures", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("8b8fa3")).toEqual({ r: 139, g: 143, b: 163 });
  });

  it("renvoie null sur une entree illisible plutot que de deviner", () => {
    expect(parseHex("#ggg")).toBeNull();
    expect(parseHex("#ff")).toBeNull();
    expect(parseHex("")).toBeNull();
  });
});

describe("contraste", () => {
  it("donne 21 entre noir et blanc, et 1 entre deux couleurs identiques", () => {
    expect(contraste(hex("#000"), hex("#fff"))).toBeCloseTo(21, 5);
    expect(contraste(hex("#5795ff"), hex("#5795ff"))).toBeCloseTo(1, 10);
  });

  it("ne depend pas de l'ordre des deux couleurs", () => {
    const a = hex("#eceef6");
    const b = hex("#14151d");
    expect(contraste(a, b)).toBeCloseTo(contraste(b, a), 10);
  });

  it("place la luminance du blanc a 1 et celle du noir a 0", () => {
    expect(luminance(hex("#fff"))).toBeCloseTo(1, 10);
    expect(luminance(hex("#000"))).toBeCloseTo(0, 10);
  });
});

describe("composer", () => {
  it("rend le fond a opacite nulle et la couche a opacite pleine", () => {
    const dessus = hex("#ffffff");
    const dessous = hex("#000000");
    expect(composer(dessus, dessous, 0)).toEqual(dessous);
    expect(composer(dessus, dessous, 1)).toEqual(dessus);
  });

  it("borne une opacite hors de [0,1]", () => {
    expect(composer(hex("#fff"), hex("#000"), 2)).toEqual(hex("#fff"));
    expect(composer(hex("#fff"), hex("#000"), -1)).toEqual(hex("#000"));
  });
});

// --- Les couleurs de l'application, pour les gardes qui suivent ---

const PANNEAU = hex("#14151d"); // --panel
const VOILE = hex("#0b0c10"); //   --bg, utilise comme voile
const SOURDINE = hex("#8b8fa3"); // --muted
const TEXTE = hex("#eceef6"); //    --text

/**
 * Pixel le plus clair de `src/assets/rift.webp`, mesure le 14 novembre 2026 en dessinant
 * l'image sur un canevas : luminance 225 sur 255. C'est le pire cas que le texte peut
 * rencontrer sur cette carte.
 *
 * Si l'illustration change, ce nombre est a remesurer — le test ne peut pas le deviner,
 * faute de decodeur webp ici.
 */
const PIXEL_LE_PLUS_CLAIR = { r: 225, g: 225, b: 225 };

/** Opacites reellement appliquees, lues dans la feuille et non recopiees a la main. */
function opacitesDeLaCarteOverlays() {
  const css: string = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  const bloc = css.slice(css.indexOf(".overlay-card img.bg"));
  const image = Number(/opacity:\s*([\d.]+)/.exec(bloc)?.[1]);
  const voiles = [...bloc.slice(0, bloc.indexOf("}", bloc.indexOf(".overlay-card .shade"))).matchAll(/rgba\(11,\s*12,\s*16,\s*([\d.]+)\)/g)].map((m) => Number(m[1]));
  return { image, voileLePlusFaible: Math.min(...voiles) };
}

describe("carte Overlays : le texte reste lisible sur la capture de jeu", () => {
  it("lit bien les opacites dans la feuille", () => {
    const { image, voileLePlusFaible } = opacitesDeLaCarteOverlays();
    expect(Number.isFinite(image)).toBe(true);
    expect(Number.isFinite(voileLePlusFaible)).toBe(true);
    expect(voileLePlusFaible).toBeGreaterThan(0);
  });

  it("garde le gris sourd au-dessus du seuil AA sur le pixel le plus clair", () => {
    // C'est exactement ce qui avait echappe a l'oeil : 3,13:1 avec l'image a 0,5 et un
    // voile a 0,55. Ce test echouera si quelqu'un eclaircit l'un ou l'autre.
    const { image, voileLePlusFaible } = opacitesDeLaCarteOverlays();
    const fond = empiler(PANNEAU, [
      { couleur: PIXEL_LE_PLUS_CLAIR, opacite: image },
      { couleur: VOILE, opacite: voileLePlusFaible },
    ]);
    expect(contraste(SOURDINE, fond)).toBeGreaterThanOrEqual(AA_TEXTE);
  });

  it("garde le texte courant tres au-dessus du seuil", () => {
    const { image, voileLePlusFaible } = opacitesDeLaCarteOverlays();
    const fond = empiler(PANNEAU, [
      { couleur: PIXEL_LE_PLUS_CLAIR, opacite: image },
      { couleur: VOILE, opacite: voileLePlusFaible },
    ]);
    expect(contraste(TEXTE, fond)).toBeGreaterThanOrEqual(AA_TEXTE * 2);
  });

  it("aurait attrape le reglage fautif", () => {
    // Garde du garde : avec les valeurs d'origine, le calcul doit bien echouer.
    const fond = empiler(PANNEAU, [
      { couleur: PIXEL_LE_PLUS_CLAIR, opacite: 0.5 },
      { couleur: VOILE, opacite: 0.55 },
    ]);
    expect(contraste(SOURDINE, fond)).toBeLessThan(AA_TEXTE);
  });
});
