# Prompt — remplir les cases vides de l'accueil

**Construit le 13 novembre 2026** : repli des cartes média, courbe de LP, coéquipiers remontés, Ta semaine, Ta prochaine marche et Faits marquants sont en place.

Constat initial fait sur une capture de l'accueil au 13 novembre 2026.

---

## 0. Contexte à donner à l'agent

> Tu travailles sur **nex.lol**, application compagnon League of Legends (Tauri 2 + Rust +
> React/TS, backend Rust local port 8787). Interface entièrement en français.
> Règles : aucune donnée inventée, chaque carte agrégée porte sa note d'échantillon, pas de
> requête Riot supplémentaire sans le dire, `npx tsc --noEmit` et `npx vitest run` doivent
> passer, la logique de calcul va dans `src/domain/` avec un test à côté.
> La page concernée est `src/features/dashboard/DashboardPage.tsx`.

---

## 1. Le problème, précisément

La moitié basse de l'accueil est vide la plupart du temps.

| Zone | État constaté | Place occupée |
|---|---|---|
| **Dernier enregistrement** | « Aucune partie enregistrée pour l'instant. » | demi-largeur, ~170 px de haut |
| **Clips récents** | « Aucun clip pour l'instant. » | demi-largeur, ~170 px de haut |
| **Collection** | une barre de progression (257 / 1964) | une tuile entière, presque vide |
| **Tes moyennes · 20 parties** | trois lignes de chiffres | une tuile, à moitié vide |
| **NEX Insight** | une courbe et une ligne de texte | une tuile, correcte mais maigre |

Le haut de la page, lui, est bon : le héros avec ses huit métriques, le rang, la dernière
session, les dernières parties avec leurs distinctions. Le problème est **sous** cette ligne.

Deux cartes sur cinq attendent une fonctionnalité que l'utilisateur n'a pas activée
(l'enregistrement). Une carte vide ne devient pas utile en restant grande : elle doit
rétrécir, et laisser la place à ce qui a toujours quelque chose à dire.

---

## 2. Règle d'abord : une carte vide se replie

Avant d'ajouter quoi que ce soit, changer le comportement des deux cartes média.

Quand il n'y a **ni enregistrement ni clip**, remplacer les deux cartes par **une seule
bande d'une ligne** : « L'enregistrement de parties est désactivé. [Activer] ». Elle garde
l'information et libère la hauteur. Dès qu'un enregistrement existe, la grille actuelle
revient telle quelle.

C'est le gain le plus net, et il ne demande aucune donnée nouvelle.

---

## 3. Ce qu'on met à la place, par ordre de valeur

Tout ce qui suit s'appuie sur des données que l'application a **déjà**. Aucune requête Riot
supplémentaire, sauf mention explicite.

### 3.1 Courbe de LP — la plus attendue

Le module existe (`src/features/profile/LpCard.tsx`, relevés dans la table
`rank_snapshots`). En poser une version compacte sur l'accueil : la courbe, le solde de la
période, et le nombre de changements. C'est ce que les applications concurrentes mettent en
premier sur leur page d'accueil, et c'est déjà construit ici.

*Coût : aucun. Lecture locale du backend.*

### 3.2 Souvent en même équipe

`TeammatesCard` existe et vit aujourd'hui en bas de la colonne de droite, sous la ligne de
flottaison. La remonter dans l'espace libéré : savoir avec qui on gagne est une des
informations les plus consultées.

*Coût : une lecture de profil par coéquipier, déjà en cache.*

### 3.3 Bilan de la semaine

`src/domain/sessions.ts` sait déjà grouper par jour et par session. Une carte « Ta semaine » :
une barre par jour des sept derniers, hauteur = parties jouées, couleur = bilan du jour,
plus une ligne de total (« 14 parties · 8V 6D · 5 h 20 de jeu »).

*Coût : aucun, c'est un calcul sur les parties déjà chargées.*

### 3.4 Ta prochaine marche

La mesure où l'écart à la médiane collectée est le plus défavorable, nommée en clair avec
sa valeur, la médiane, et le lien vers sa page du Data Studio.
Exemple : « CS/min 4,0 — médiane 7,5. C'est ton plus gros écart. »

Une seule mesure, celle qui compte le plus, pas un tableau. La carte **NEX Insight** actuelle
fait déjà quelque chose de proche à partir du Score NEX : soit on la remplace, soit on la
nourrit avec la médiane collectée plutôt qu'avec un repère provisoire.

*Coût : un appel `/v1/stats/baselines`, déjà servi localement et mis en cache 10 min.*

### 3.5 Tes champions du moment

Les trois à cinq champions les plus joués sur l'échantillon, avec parties, taux de victoire
et KDA. `championAggregates` existe, `ChampionPerformance` l'affiche déjà en bas : la
remonter et l'élargir suffit.

*Coût : aucun.*

### 3.6 Faits marquants

À partir de `src/domain/badges.ts`, déjà écrit : compter les distinctions sur les parties
chargées et en tirer deux ou trois lignes concrètes. « 4 fois MVP · 3 fois le plus de
dégâts · 1 pentakill ». C'est du vécu, pas une moyenne, et ça se lit en une seconde.

*Coût : aucun, les badges sont calculés en mémoire.*

---

## 4. Disposition proposée

En gardant le haut tel quel :

```
┌───────────────────────── héros + 8 métriques ─────────────────────────┐   ┌── rang ──┐
└───────────────────────────────────────────────────────────────────────┘   ├ session ─┤
┌──────────── courbe de LP ────────────┐┌──── souvent en même équipe ───┐   │ dernières│
└──────────────────────────────────────┘└───────────────────────────────┘   │  parties │
┌── ta semaine ──┐┌─ prochaine marche ─┐┌───── tes champions ───────────┐   │          │
└────────────────┘└────────────────────┘└───────────────────────────────┘   └──────────┘
│ L'enregistrement de parties est désactivé.                   [Activer] │
┌── faits marquants ──┐┌──── collection ────┐┌──────── overlays ────────┐
```

La bande d'enregistrement ne réapparaît en deux grandes cartes que lorsqu'il y a vraiment
un enregistrement ou un clip à montrer.

---

## 5. Ce qu'il ne faut pas faire

- **Ne pas remplir avec des données d'exemple.** Une carte sans donnée réelle dit ce qui
  manque et comment l'obtenir, en une ligne, et rétrécit.
- **Ne pas multiplier les moyennes.** Le héros en affiche déjà huit. Les nouvelles cartes
  doivent apporter autre chose : une évolution, une comparaison, un fait.
- **Ne pas ajouter de requête Riot pour l'accueil.** C'est la page ouverte le plus souvent,
  et le quota est de 100 requêtes par deux minutes, partagé avec le collecteur.
- **Ne pas déplacer le haut de page.** Le héros, le rang, la session et les dernières
  parties fonctionnent ; le problème est uniquement sous eux.

---

## 6. Ordre conseillé

1. Le repli des deux cartes média (§2) — le gain le plus visible, le moins de code.
2. La courbe de LP (§3.1) — déjà construite ailleurs.
3. Ta semaine (§3.3) et Faits marquants (§3.6) — calculs locaux, aucune dépendance.
4. Prochaine marche (§3.4) — demande de décider si elle remplace NEX Insight.
5. Remontée de « Souvent en même équipe » et des champions (§3.2, §3.5).
