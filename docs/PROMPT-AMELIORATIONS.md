# Prompt — rendre NEX plus solide

Ce document ne liste pas des idées de fonctionnalités. Il liste ce qui a **réellement coûté
du temps ou laissé passer un défaut** pendant une longue session de travail sur l'application,
le 14 novembre 2026, avec les mesures faites à ce moment-là.

Chaque point porte sa preuve. Rien n'est ici au nom du bon goût.

---

## 0. Contexte à donner à l'agent

> Tu travailles sur **nex.lol**, application compagnon League of Legends (Tauri 2 + Rust +
> React/TS, backend Rust local sur le port 8787, SQLite). Interface en français.
>
> Règles du projet :
> - Aucune donnée inventée ; chaque agrégat porte la taille de son échantillon.
> - Pas de requête Riot supplémentaire sur l'accueil (quota : cent par deux minutes,
>   partagé avec le collecteur).
> - La logique de calcul va dans `src/domain/`, avec un test à côté.
> - `npx tsc --noEmit` et `npx vitest run` doivent passer.
> - Ne jamais écrire dans le client League sans action explicite de l'utilisateur.
>
> **N'entreprends aucune réécriture.** Chaque point ci-dessous se règle par un ajout ou un
> déplacement, pas par une refonte. Si un point demande plus d'une journée, il est mal
> compris : redemande.

---

## 1. Les collisions de CSS — le plus coûteux, de loin

### Ce qui s'est passé

Trois fois dans la même session, une règle CSS a été écrasée par une autre sans que rien ne
le signale. À chaque fois le symptôme ressemblait à un bug de logique, et la recherche a
pris plusieurs minutes :

1. `.rune-tree` existait déjà dans `stats.css` pour la page Builds, avec deux colonnes. Une
   nouvelle carte du Profil a repris le même nom : ses lignes sont tombées à 80 px et sept
   noms de runes sur neuf étaient tronqués.
2. Un bloc `.player-picker` mort, laissé par une version précédente, venait **après** le
   nouveau dans la même feuille et pilotait la taille et l'opacité des portraits.
3. Une règle `.intro-embleme img` laissée en place lors d'un changement annulait un rognage
   en ramenant l'image à 100 % de sa fenêtre.

Et une quatrième, **livrée à l'utilisateur** : le fondu de l'emblème de rang posait un
retrait de 18 px. `.rank-card` ne sert pas qu'à l'accueil — les blocs de rang du Profil
portent la même classe avec un emblème de 54 px. Le retrait y rognait un tiers de l'image.
C'est l'utilisateur qui l'a vu, pas les tests.

### La mesure

Au moment d'écrire : **7 512 lignes de CSS** réparties en feuilles toutes globales,
**734 classes** définies, dont **37 définies dans plusieurs feuilles à la fois** —
`brand-mark`, `active`, `content`, `avatar`, `hero-art`, `icon-btn`, `data-table`…
Et **aucun linter dans le projet** : ni ESLint, ni Stylelint, ni Prettier, ni CI.

`brand-mark` est dans cette liste, et c'est précisément la classe qui rendait le prop `size`
de `NexLogo` **sans effet partout dans l'application** : `shell.css` lui impose 30 px, ce qui
annule l'attribut de taille du SVG. Un prop de composant qui ne fait rien, en silence.

### Fait le 14 novembre 2026 — outillage posé, doublons restants

- `scripts/css-doublons.mjs` liste les classes définies dans plusieurs feuilles et celles
  qui ne sont citées nulle part. Branché dans `npm run check` via `--check`, qui échoue sur
  un doublon **nouveau** seulement : la base `scripts/css-doublons-connus.json` fige
  l'existant pour que la vérification ne soit pas ignorée dès le premier jour.
  Garde-fou éprouvé en introduisant un faux doublon : il sort en erreur et nomme les deux
  feuilles.
- Première version du script : 37 doublons annoncés. Elle comptait `.intro .muted { }` comme
  une redéfinition de `.muted`, ce qui est une surcharge contextuelle parfaitement normale.
  En ne retenant que les règles portant **directement** sur la classe, il en reste **4** :
  `.content`, `.neg`, `.ov-widget`, `.select`. Un rapport bruyant ne se lit pas.
- Stylelint, avec quatre règles seulement — pas la config standard, qui sortirait des
  centaines de remarques de style sur 7 500 lignes. Il a trouvé deux sélecteurs écrits en
  deux fois dans `intro.css`, fusionnés.

**Reste à faire** : les 4 doublons ci-dessus, un par un, et la revue des 28 classes jamais
citées (certaines sont de faux positifs).

### Ce qu'il faut faire

1. Ajouter **Stylelint** avec, au minimum, `no-duplicate-selectors` et
   `no-descending-specificity`. C'est le strict nécessaire ; inutile d'adopter une
   convention de nommage complète maintenant.
2. Écrire un petit script (`scripts/css-doublons.mjs`) qui liste les classes définies dans
   plus d'une feuille et celles qui ne sont citées nulle part dans `src/**/*.ts*`. Le
   brancher dans `npm run check`. Il existe déjà une version jetable de cette mesure dans
   l'historique de la session : 43 classes jamais citées, 37 en double.
3. Traiter les 37 doublons un par un. Pour chacun : soit renommer l'un des deux, soit
   constater que c'est voulu et l'écrire en commentaire au-dessus des deux règles.

**Ne pas** migrer vers CSS Modules ou Tailwind. Le coût dépasse largement le problème, et
les deux feuilles les plus grosses sont lisibles.

---

## 2. ~~L'étape du backend embarqué est manuelle~~ — fait le 14 novembre 2026

`npm run tauri build` ne compile **que** le frontend : son `beforeBuildCommand` est
`tsc && vite build`. Le backend embarqué passe par `scripts/build-sidecar.ps1`, qui est un
geste séparé — son propre commentaire le dit : « à lancer avant `npx tauri build` dès que le
backend change ».

Pendant la session, ce geste a été oublié une fois. L'installeur produit embarquait un
backend vieux de quatre heures. **Rien ne le signalait** : l'application se lançait
normalement et affichait simplement « Non fourni » sur deux cartes, ce qui se lit comme un
bug du code et non comme une version périmée. Le défaut n'a été vu qu'en comparant les
horodatages des fichiers à la main.

**Fait** : `beforeBuildCommand` pointe sur `npm run build:app`, qui enchaîne
`npm run sidecar` puis `npm run build`. Vérifié en lançant `npm run tauri build` sans
appeler le script : la sortie montre la chaîne et « backend embarque pret ». Le README et
le commentaire en tête du script disaient tous deux de le lancer à la main : corrigés.

---

## 3. ~~Le backend en release refuse l'origine du serveur de développement~~ — faux

**Ce point était une erreur de diagnostic. Il n'y a rien à corriger.** Il reste écrit ici
pour que personne ne le redécouvre à ses frais.

Ce que j'avais conclu : vérifier une modification dans le navigateur obligeait à arrêter
l'application de l'utilisateur, parce que le backend compilé en *release* n'accepterait pas
l'origine du serveur de développement.

Ce que dit le code : **il n'y a aucun filtrage d'origine, et aucun CORS, nulle part dans le
backend.** La page de développement n'en a pas besoin — elle passe par le proxy Vite
`/nex-api` déclaré dans `vite.config.ts`, qui relaie vers `127.0.0.1:8787`. C'est du
même-origine, et cela fonctionne avec n'importe quel backend écoutant sur ce port.

Vérifié : page de développement chargée pendant que le backend **installé** tournait,
`/nex-api/v1/health` répond 200 et l'application affiche le rang et les parties.

D'où venait l'erreur : d'un `fetch("http://127.0.0.1:8787/...")` tapé dans la console de la
page. Celui-là est bien cross-origin et échoue faute de CORS — mais l'application ne fait
jamais cet appel. J'ai pris l'échec de ma sonde pour un échec de l'application, et j'ai
fermé l'application de l'utilisateur sept fois dans la journée sans aucune nécessité.

**La leçon, elle, vaut d'être gardée** : sonder un système par un chemin que le vrai code
n'emprunte pas mesure la sonde, pas le système.

---

## 4. `DashboardPage.tsx` fait 1 077 lignes

Toutes les cartes de l'accueil y vivent : héros, rang, session, semaine, champions, overlays,
collection, parties récentes, médias. Trois composants en sont déjà sortis pendant la session
(`ProgressCards.tsx`) sans difficulté : le fichier se découpe bien.

**À faire** : sortir les cartes par familles, un fichier par famille, en déplaçant le code
sans le réécrire. Même traitement pour `LeaderboardsPage.tsx` (989 lignes). Ne pas toucher à
`platform/api.ts` (893 lignes) : c'est une liste de types, sa longueur est normale.

---

## 5. Le backend reste orphelin quand l'application est tuée

Un arrêt propre ferme bien le processus `nex-backend`. Une fermeture forcée le laisse
tourner : il a été retrouvé plusieurs heures après, en écoute sur 8787. Au lancement suivant,
l'application voit le port occupé et **n'allume pas son backend embarqué** — elle parle à
l'orphelin, qui peut être une version ancienne.

**À faire** : au démarrage, si quelque chose écoute déjà sur 8787, vérifier que c'est bien un
`nex-backend` de la même version (la route `/v1/health` porte déjà `version`) et, sinon, le
dire clairement plutôt que de s'y brancher en silence.

---

## 6. Rien ne vérifie le rendu

Les 128 tests sont tous des tests de logique sur `src/domain/`. Ils sont bons et ils passent.
Aucun ne regarde une page.

Conséquence directe : les quatre collisions du §1 et le contraste du §7 sont tous passés à
travers. Un test de rendu minimal les aurait pris.

**À faire, petit** : quelques tests de rendu avec `@testing-library/react` sur les deux ou
trois pages qui changent le plus, vérifiant la présence des blocs et l'absence de doublons,
pas l'apparence. **Ne pas** introduire de comparaison d'images : le coût de maintenance est
sans commune mesure avec le bénéfice ici.

---

## 7. Le contraste n'est vérifié par rien

En posant un fond de jeu sur la carte Overlays, la colonne de référence du tableau (gris
sourd `#8b8fa3`) est tombée à **3,13:1** sur les zones claires de l'image, sous le seuil de
4,5. À l'œil sur une capture, ça passait. Le défaut n'a été trouvé qu'en compositant les
couches et en calculant le rapport.

**À faire** : une petite fonction dans `src/domain/` qui calcule un rapport de contraste,
avec ses tests, et l'utiliser dans les quelques endroits où du texte passe sur une image
(héros, carte de rang, collection, overlays). Pas un audit complet de l'application : les
endroits à risque sont peu nombreux et connus.

---

## 8. Ordre conseillé

1. ~~§2~~ — **fait** : le sidecar part depuis `beforeBuildCommand`.
2. ~~§1~~ — **fait** : Stylelint, le script de doublons branché dans `npm run check`, et
   les quatre doublons résolus. La base du garde-fou est vide.
3. ~~§3~~ — **sans objet** : diagnostic faux, rien à corriger.
4. §5 — court, et évite une confusion de version difficile à diagnostiquer.
5. §7 — petite fonction, tests simples.
6. §6 puis §4 — les deux plus longs, les moins urgents.

---

## 9. Ce qu'il ne faut pas faire

- **Pas de refonte.** Aucun point ci-dessus ne la demande.
- **Pas de nouvelle dépendance lourde** : ni framework CSS, ni moteur d'animation, ni
  comparaison d'images. Stylelint et `@testing-library/react` suffisent.
- **Ne pas supprimer une règle CSS parce qu'un script la dit morte** sans vérifier : les
  classes construites par morceaux (`` `brand-mark${draw ? " brand-mark-draw" : ""}` ``)
  ressortent comme mortes alors qu'elles servent.
- **Ne pas traiter les 37 doublons en une seule fois** dans un commit unique. Un par un,
  vérifiable.
