// Detecte les classes CSS definies dans plusieurs feuilles, et celles qui ne sont citees
// nulle part dans le code.
//
// Pourquoi : les feuilles de NEX sont toutes globales (~7 500 lignes). Une classe redefinie
// ailleurs gagne silencieusement selon l'ordre de chargement, et le symptome ressemble a un
// bug de logique. C'est arrive quatre fois sur une seule session de travail, dont une fois
// jusqu'a l'utilisateur : `.rank-card` sert a l'accueil ET aux blocs de rang du profil, et
// un retrait de 18 px pense pour un embleme de 132 px en rognait un tiers sur celui de 54.
//
// Usage :
//   node scripts/css-doublons.mjs            rapport complet
//   node scripts/css-doublons.mjs --check    sort en erreur sur un doublon NOUVEAU
//   node scripts/css-doublons.mjs --maj      fige les doublons actuels comme connus
//
// Les doublons connus sont listes dans css-doublons-connus.json : le but n'est pas de faire
// echouer `npm run check` des le premier jour sur l'existant, mais d'empecher les suivants.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RACINE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DOSSIER_CSS = join(RACINE, "src", "styles");
const BASE = join(RACINE, "scripts", "css-doublons-connus.json");

/** Tous les fichiers sous un dossier, extension donnee. */
function fichiers(dossier, exts) {
  const out = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) out.push(...fichiers(chemin, exts));
    else if (exts.some((e) => nom.endsWith(e))) out.push(chemin);
  }
  return out;
}

/** Classes DEFINIES par feuille — pas simplement citees.
 *
 *  Une classe compte comme definie quand une regle porte sur elle directement : `.foo`,
 *  `.foo:hover`, `.foo.bar`. Une surcharge contextuelle comme `.intro .muted { }` ne compte
 *  pas : c'est le fonctionnement normal d'une feuille globale, et la signaler noierait les
 *  vrais conflits. Sans cette distinction le rapport sortait 37 lignes dont la quasi-totalite
 *  etait legitime, et un rapport bruyant ne se lit pas.
 *
 *  Les commentaires sont retires d'abord : ils citent souvent des classes en prose. */
function classesDefinies() {
  const par = new Map();
  for (const f of fichiers(DOSSIER_CSS, [".css"])) {
    const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const nom = relative(RACINE, f).replace(/\\/g, "/");
    for (const regle of css.matchAll(/([^{}]+)\{/g)) {
      const entete = regle[1].trim();
      if (entete === "" || entete.startsWith("@")) continue;
      for (const sel of entete.split(",")) {
        // Le selecteur porte entierement sur une classe : ni espace, ni combinateur.
        const m = /^\.(-?[A-Za-z_][\w-]*)(?:[:.[][^\s>+~]*)?$/.exec(sel.trim());
        if (!m) continue;
        if (!par.has(m[1])) par.set(m[1], new Set());
        par.get(m[1]).add(nom);
      }
    }
  }
  return par;
}

/** Tout mot ressemblant a une classe et cite dans le code.
 *
 *  Deux passes, parce qu'une seule ment. Les chaines donnent les classes d'un seul mot
 *  (`card`, `muted`). Mais une classe construite par morceaux vit a cheval sur un gabarit —
 *  `` `intro-logo${x ? " intro-logo-pose" : ""}` `` — et le balayage des chaines s'arrete au
 *  premier guillemet interieur : `intro-logo-pose` ressortait comme morte alors qu'elle sert.
 *  D'ou la seconde passe sur tous les mots a trait d'union du fichier : un identifiant JS ne
 *  peut pas en contenir, donc elle est sans risque. */
function motsDuCode() {
  const vus = new Set();
  for (const f of fichiers(join(RACINE, "src"), [".ts", ".tsx"])) {
    const txt = readFileSync(f, "utf8");
    for (const m of txt.matchAll(/["'`]([^"'`\n]{0,200})["'`]/g)) {
      for (const mot of m[1].matchAll(/[A-Za-z][\w-]*/g)) vus.add(mot[0]);
    }
    for (const mot of txt.matchAll(/[A-Za-z][\w]*(?:-[\w]+)+/g)) vus.add(mot[0]);
  }
  return vus;
}

const definies = classesDefinies();
const utilisees = motsDuCode();

const doublons = [...definies.entries()]
  .filter(([, f]) => f.size > 1)
  .map(([c, f]) => ({ classe: c, feuilles: [...f].sort() }))
  .sort((a, b) => a.classe.localeCompare(b.classe));

const jamaisCitees = [...definies.keys()].filter((c) => !utilisees.has(c)).sort();

const mode = process.argv[2];

if (mode === "--maj") {
  const contenu = {
    note: "Doublons connus au moment ou le script a ete pose. Le but est d'empecher les NOUVEAUX, pas de bloquer sur l'existant. Retirer une entree d'ici quand le doublon est resolu.",
    classes: doublons.map((d) => d.classe),
  };
  writeFileSync(BASE, JSON.stringify(contenu, null, 2) + "\n", "utf8");
  console.log(`Base mise a jour : ${doublons.length} doublons connus.`);
  process.exit(0);
}

let connus = [];
try {
  connus = JSON.parse(readFileSync(BASE, "utf8")).classes ?? [];
} catch {
  // Pas de base : tous les doublons sont nouveaux.
}
const nouveaux = doublons.filter((d) => !connus.includes(d.classe));

if (mode === "--check") {
  if (nouveaux.length === 0) {
    console.log(`CSS : aucun nouveau doublon de classe (${doublons.length} connus).`);
    process.exit(0);
  }
  console.error(`CSS : ${nouveaux.length} classe(s) nouvellement definie(s) dans plusieurs feuilles.\n`);
  for (const d of nouveaux) console.error(`  .${d.classe}\n    ${d.feuilles.join("\n    ")}`);
  console.error("\nRenommer l'une des deux, ou — si le partage est voulu — l'ecrire en commentaire");
  console.error("au-dessus des deux regles puis lancer : node scripts/css-doublons.mjs --maj");
  process.exit(1);
}

console.log(`${definies.size} classes definies dans ${fichiers(DOSSIER_CSS, [".css"]).length} feuilles.\n`);
console.log(`Definies dans plusieurs feuilles : ${doublons.length}${nouveaux.length ? ` (dont ${nouveaux.length} nouvelles)` : ""}`);
for (const d of doublons) {
  console.log(`  ${connus.includes(d.classe) ? " " : "+"} .${d.classe}  ->  ${d.feuilles.join(", ")}`);
}
console.log(`\nJamais citees dans le code : ${jamaisCitees.length} (indicatif, pas une erreur)`);
console.log(`  ${jamaisCitees.join(", ")}`);
console.log("\nUne classe construite par morceaux peut ressortir ici a tort : verifier avant de supprimer.");
