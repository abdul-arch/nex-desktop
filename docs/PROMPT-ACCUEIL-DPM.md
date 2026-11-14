# Prompt — reproduire l'accueil de DPM à l'identique

Référence : capture de l'accueil de DPM.LOL (desktop v1.8.1), fenêtre 1371 × 888, fournie
avec la demande.

**Consigne : reproduire la mise en page telle quelle.** Pas d'adaptation, pas de
réinterprétation, pas de « version NEX » du concept. Si un détail de la capture semble
discutable, il est reproduit quand même.

**Seule exception demandée : la carte « DPM Lens » est hors périmètre.** Ne pas la
reproduire, ne pas la remplacer, ne pas combler sa place par autre chose — la colonne se
referme sur les deux cartes restantes de cette rangée.

---

## État — appliqué le 14 novembre 2026

Ce document a servi. Ce qui suit reste la référence, mais trois choses ont changé depuis
sa rédaction et il faut les lire avant de reprendre le travail.

**Trois étapes étaient déjà faites** dans le code au moment de l'appliquer, vérification
faite dans les fichiers et non à l'œil :

- `.dash` était déjà en `minmax(0, 1fr) 300px` avec 14 px de gouttière, soit les
  795 / 14 / 304 relevés au pixel sur la capture (§1).
- `.metrics` était déjà en `repeat(4, minmax(0, 1fr))` : le héros était déjà en quatre
  colonnes sur deux rangées (§3).
- `ScoreRing` était déjà branché dans la liste des parties du rail avec son `rankLabel`,
  ce qui est exactement l'anneau « 88 / 2e » de la capture (§4).

**L'écart réel était l'ordre des blocs**, pas la structure. Il est corrigé.

**La carte « partie pro en cours » n'est pas réalisable.** Voir §5, réécrit.

---

## 0. Contexte à donner à l'agent

> Tu travailles sur **nex.lol**, application compagnon League of Legends (Tauri 2 + Rust +
> React/TS, backend Rust local sur le port 8787, SQLite). Interface en français.
> La page concernée est `src/features/dashboard/DashboardPage.tsx` (~1200 lignes, toutes les
> cartes y vivent) et sa feuille `src/styles/dashboard.css`.
>
> Contraintes du projet, qui ne sont pas des choix de design et restent valables :
> - Aucune donnée inventée. Chaque agrégat porte la taille de son échantillon.
> - **Aucune requête Riot supplémentaire au chargement de l'accueil** : c'est la page la plus
>   ouverte, et le quota est de 100 requêtes par deux minutes, partagé avec le collecteur.
> - La logique de calcul va dans `src/domain/`, avec un test à côté.
> - `npx tsc --noEmit` et `npx vitest run` doivent passer.
> - Le nom et le logo de l'en-tête sont ceux de NEX : c'est l'application de l'utilisateur.

---

## 1. Géométrie, relevée sur la capture

Mesures prises au pixel sur la capture de 1371 px de large :

| Zone | Mesure | Part de la largeur utile |
|---|---|---|
| Barre latérale | 221 px | — |
| Zone de contenu | 1113 px | 100 % |
| Colonne principale | 795 px | 71,4 % |
| Gouttière entre colonnes | 14 px | 1,3 % |
| Colonne de droite (rail) | 304 px | 27,3 % |

La colonne de droite **ne défile pas séparément** : les deux colonnes défilent ensemble.
Écart vertical entre cartes : 14 px. Rayon des coins : 12 px. Les cartes du bas de la
colonne principale sont sur une rangée de trois.

---

## 2. Palette

Relevée sur la capture : fond de page entre `#0d0f14` et `#12151f`, fond de carte entre
`#161a1e` et `#1c1d21`, tuiles de mesure légèrement plus claires que leur carte.

**C'est déjà la palette de NEX.** `--bg: #0b0c10` et `--panel: #14151d` dans
`src/styles/tokens.css` sont à quelques points de ces valeurs. Reproduire le design ne
demande donc aucun changement de couleur : garder les jetons existants donne le même rendu.
Vérifié à l'application : aucune couleur n'a eu besoin d'être touchée.

Couleurs de signal, à reprendre telles que la capture les utilise :

- Variation favorable : vert. Variation défavorable : rouge.
- Écart de LP gagné : bleu clair. Écart de LP perdu : rouge.
- La capture **écrit le signe** devant chaque variation (`+0.8`, `−328`, `+22 LP`,
  `−18 LP`). Le reproduire : le signe fait partie du design d'origine.

---

## 3. Contenu, carte par carte

### En-tête

Titre avec icône maison, puis un texte d'une ligne sur fond de carte, un bouton d'action à
pastille, le groupe de filtres de file (`Toutes / Solo / Flex / 5c5 / ARAM / Normale`) en
pastilles jointives, et à droite deux choix de période (`30 dernières parties` / `Saison`).

### Colonne principale

**1. Héros.** Fond en art de champion sur toute la carte, dégradé vers le fond sombre à
gauche. À gauche : portrait d'invocateur avec son niveau en pastille, badge de région au
dessus, puis le pseudo en très gros et le tag en dessous. En haut à droite : trois petits
boutons à icône, et la mention « vs. ta moyenne ».

En dessous, **huit tuiles de mesure en 4 colonnes × 2 rangées**, occupant toute la largeur
de la carte. Chaque tuile : libellé en petit gris, valeur en gros chiffres tabulaires,
variation signée et colorée en dessous, **courbe à étincelles à droite**. Dans la capture :
KDA, Score, KP %, CS/min sur la première rangée ; Dégâts/min, Part des dégâts, Écart d'or
@15, Solo kills sur la seconde.

**2. Rangée de deux cartes.**

- *Partie pro en cours* — **non reproduite, voir §5 avant d'y revenir.** Description de la
  capture, pour mémoire : deux splashs de champions qui se font face, séparés par un `VS`
  incliné. En haut : minuteur et région. En bas : les joueurs et leurs champions de part et
  d'autre, les icônes de champions des deux équipes, et un bouton **Regarder** au centre. Une
  flèche de chaque côté pour passer à une autre partie.
- *Dernière partie* — bandeau `VICTOIRE` + durée en haut à gauche sur un fond en art de
  champion, puis une liste d'extraits : vignette avec durée en pastille, titre, ancienneté.
  En bas, une ligne « partie complète » avec la file, l'ancienneté, le score et le KDA, et un
  lien « Tout voir ».

**3. Rangée de trois cartes — ici deux, la troisième étant DPM Lens, exclue.**

- *Overlays* — trois minuteurs en haut sur fond sombre, puis un tableau à deux colonnes
  comparant tes valeurs à une référence, ligne par ligne : CS/min, Or/min, KDA, KP %, Vision.
  Lien « Overlays ↗ » en bas.
- *Collection* — fond en art de champion, titre avec lien, puis « Skins possédés » avec le
  compte sur le total et une barre de progression.

### Colonne de droite

**1. Rang.** Fond en art sombre. Libellé de file en petit, nom du palier en très gros et en
couleur, puis les LP, le bilan victoires/défaites et le pourcentage.

**2. Liste des parties.** Une ligne par partie, bord gauche coloré selon l'issue :
écart de LP signé et coloré, ancienneté et file en dessous, portrait du champion, K/D/A en
chiffres tabulaires avec le KDA dessous, et à droite un **anneau de score** portant la valeur
au centre et un rang en dessous (`2e`, `4e`, `ACE`, `MVP`, `10e`, `5e`). Un chevron en bas
déplie la suite.

**3. Performances par champion.** Trois champions en portrait avec leur bilan et trois
chiffres (KDA détaillé), puis une rangée de petites icônes de champions et un bouton `Tous`.

**4. Répartition des postes.** Cinq icônes de poste avec, sous chacune, un pourcentage et le
nombre de parties.

---

## 4. Ce que NEX a déjà — à brancher, pas à réécrire

| Élément de la capture | Ce qui existe dans le code |
|---|---|
| Courbe à étincelles | `Sparkline` dans `src/ui/primitives.tsx` |
| Anneau de score avec rang | `ScoreRing({ value, size, label, rank })` — il accepte déjà le rang |
| Les huit mesures du héros | Déjà calculées et affichées sur l'accueil actuel |
| Carte de rang, liste des parties | Existent |
| Performances par champion | `championAggregates` dans `src/domain/metrics.ts` |
| Répartition des postes | Existe |
| Collection, Overlays | Existent |
| Partie pro | `backend/src/pro.rs` (`ProAccountDto`, `parse_soloqueue_ids`) et la page Spectate |
| Distinctions (`ACE`, `MVP`) | `matchAwards` dans `src/domain/badges.ts` |

---

## 5. Les deux cartes sans source chez NEX — une repliée, une abandonnée

La capture les montre remplies ; chez NEX elles peuvent être vides. Dans ce cas :

- **Extraits de la dernière partie** — l'enregistrement est désactivé par défaut. La carte
  garde le résumé de la partie et remplace la liste d'extraits par une ligne
  « L'enregistrement de parties est désactivé. [Activer] ». Jamais quatre vignettes vides.
- **Partie pro** — **abandonnée après audit.** Ne pas la retenter sans avoir lu ce qui
  suit ; le mur n'est pas un manque de temps mais l'architecture de NEX.

  Ce que les sources disent :
  - `/v1/pro/teams` sert un effectif Leaguepedia (équipes, joueurs, comptes) **sans aucun
    état de partie**.
  - `/v1/live/{platform}/{puuid}` prend **un puuid précis**. Il n'existe pas d'endpoint
    « parties en vedette ».
  - Savoir qu'un pro joue demande donc un profil puis un live **par compte**, soit deux
    requêtes chacun. Le quota est de cent requêtes par deux minutes, partagé avec le
    collecteur : quelques dizaines de pros le consomment entièrement.

  DPM y arrive parce qu'un serveur central surveille les pros pour tous ses clients. Le
  backend de NEX tourne sur la machine du joueur avec sa propre clé : il n'a pas cette vue
  partagée. La carte serait une bande vide en permanence.

  **À sa place**, la même fonction — quelqu'un joue maintenant, on peut regarder — avec une
  source que NEX possède : les amis observables, lus dans le client League
  (`observableFriends`, aucune requête Riot, même clé de cache que la page Spectate). Le
  client n'est sollicité que sur le clic « Regarder ». La rangée passe à trois colonnes
  quand un ami joue et reste à deux sinon.

---

## 6. Ce que la reproduction déplace hors de l'accueil — fait

La capture ne contient pas ces cartes. Elles ont été **déplacées vers le Profil, pas
supprimées**. Deux d'entre elles (courbe de LP, coéquipiers) y étaient déjà : elles étaient
affichées aux deux endroits, et seul l'accueil les a perdues. Les trois autres vivent
maintenant dans `src/features/profile/ProgressCards.tsx`.

Effet de bord relevé à cette occasion : la deuxième page de parties Riot (clé
`dash-mates`, vingt parties de plus) n'était chargée que pour la carte des coéquipiers.
Elle est partie avec elle, donc **l'accueil fait un appel Riot de moins au chargement**.

Liste, pour mémoire :

- Historique des LP (`src/features/profile/LpCard.tsx`) — donnée que NEX est seul à avoir,
  puisque Riot ne fournit que le rang courant.
- Ta semaine, Ta prochaine marche, Faits marquants, Tes moyennes, NEX Insight.
- Souvent en même équipe (`src/features/dashboard/TeammatesCard.tsx`).

---

## 7. Vérifications avant de rendre

- `npx tsc --noEmit` et `npx vitest run` passent.
- Aucune requête réseau supplémentaire au premier affichage : le vérifier dans l'onglet
  réseau, pas au jugé.
- Les proportions du §1 sont respectées à 1371 px de large.
- La page ne défile pas horizontalement entre 900 px et 1920 px.
- Chaque carte sans donnée affiche son état réel, jamais un zéro.
- Chaque agrégat porte son nombre de parties.
