# Assistant ARAM Mayhem — augments

Notes NEX affichées sur les cartes d'augments proposées pendant une partie ARAM Mayhem (mode `KIWI`). Ces notes sont une appréciation heuristique et éditoriale : ce n'est ni un taux de victoire ni une garantie. NEX n'est ni approuvé ni sponsorisé par Riot Games.

## 1. Audit des sources (8 novembre 2026, patch 16.22)

| Besoin | Source vérifiée | Résultat |
| --- | --- | --- |
| Cartes proposées | Client local (LCU) : documentation embarquée `/help`, toutes les fonctions et tous les types | **Aucune donnée.** Seuls existent les cosmétiques TFT (`AugmentPillar`) et l'inventaire Arena (`cherry-inventory`). Le choix se fait dans le processus du jeu, pas dans le client. |
| Cartes proposées, augments choisis | Live Client Data (port 2999), schéma OpenAPI publié par le jeu, lu pendant une vraie partie `KIWI` | **Aucune donnée.** 0 occurrence de « augment », « kiwi », « mayhem », « arena » dans le schéma ; aucun champ d'augment dans les joueurs. Disponibles : mode, champion, niveau, objets, scores. |
| Catalogue | CommunityDragon : `augment-lists.json` (liste `KIWI`, 242 augments) et `cherry-augments.json` (anglais et français) | Identifiant, noms, rareté (Argent, Or, Prismatique), icône. **Pas de description.** La liste `KIWI` est distincte de `CHERRY` (Arena) et de `KIWI_JADE`. |
| Lecture des cartes | OCR intégré à Windows (`Windows.Media.Ocr`) | Disponible en fr-FR et en en-US sur la machine de référence. Local, sans nouveau runtime ni modèle à télécharger. |
| SDK tiers (Overwolf, etc.) | — | Runtime distinct, non utilisable depuis Tauri. Écartés. |
| Popularité, combos | Export public arammayhem.com (`/data/v1/`), pages du site, serveur MCP | Export sous **CC BY 4.0** : pick rate, rang par pick rate, combos étiquetés. Tiers et taux de victoire : **non publiés sous licence**, non importés. Détail au § 9. |

**Conséquences**
- L'identification automatique des cartes passe par la **lecture locale des titres** à l'écran (OCR Windows).
- Les augments déjà choisis ne sont exposés nulle part : ils sont **confirmés par le joueur**. La disparition d'une carte ne prouve pas qu'elle a été choisie.
- Les cartes ne s'affichent que pour le joueur : le mode spectateur ne les montre pas. **La lecture automatique ne peut être validée que dans une partie jouée.**

## 2. Validation menée

| Niveau | Ce qui est validé |
| --- | --- |
| Fixtures (tests unitaires) | Moteur : conditions, plafonds, égalités, tiers absolus, `?`, meilleure affinité. Cycle de vie : relance, réponse tardive, disparition, expiration, perte de focus, nouvelle partie, mode manuel. |
| Lecture réelle (`crates/nex-mayhem/tests/real_capture.rs`) | Textes lus par l'OCR Windows pendant une vraie partie (8 novembre 2026, 2560×1440, client en anglais). Les trois cartes sont identifiées dans l'ordre : deux titres exacts, « 0k Boomerang » reconnu par approximation. Positions à moins de 1 %. La liste verticale de noms affichée par une autre application est rejetée. |
| Vraie partie Windows (observateur de calibration, 8 novembre 2026) | Trois phases de choix lues pendant une partie jouée (2560×1440, client en anglais) : 2 cartes sur 3, puis 3 sur 3 à deux reprises, OCR en 141 à 153 ms. |
| Pixels réels, chaîne Rust complète (`screen::tests::ocr_screen_probe`) | Les trois captures de la partie affichées en plein écran : copie GDI, OCR Windows, identification. **9 cartes sur 9**, dans l'ordre, à x = 0,309 / 0,500 / 0,691, trois essais identiques, copie ~20 ms et OCR ~30 ms (build de développement). |
| Données publiques (`crates/nex-mayhem/tests/reference_cases.rs`) | Extrait daté de l'export arammayhem.com (publication du 8 novembre 2026) face au catalogue Riot 16.22 : couverture de la correspondance, absence de toute capacité de tier, cas de référence de la spécification, ordre des combos, combos historiques masqués, interactions « bug » signalées. Voir § 9.6. |
| Overlay réel (build release, overlay seul) | Captures affichées dans une fenêtre portant le titre du jeu, lecture par Ctrl+Alt+A. Les badges se placent dans la zone libre basse de chaque carte, sans masquer ni le nom, ni l'effet, ni la relance. Panneau de détail (Ctrl+Alt+D) à droite des cartes. Lors du changement complet des cartes, la version 2 remplace la version 1. Badges retirés à la perte de focus. |

**Points non validés**
- Badges pendant une partie jouée : les cartes ne sont visibles que pour le joueur.
- Autres résolutions et échelles d'interface.
- Client en français pendant une partie.
- Relance d'une seule carte dans le jeu (couverte par les tests du cycle de vie seulement).
- Plein écran exclusif : l'overlay ne peut pas s'y afficher.
- Écrans multiples : l'overlay couvre l'écran principal.

## 3. Catalogue et règles

- **Catalogue** (`nex_mayhem::catalog`) : construit depuis CommunityDragon pour le mode et le patch. Mis en cache. Les entrées invalides sont ignorées. Il ne contient aucune note.
- **Règles** (`nex_mayhem::rules`) : données JSON versionnées et validées, jamais exécutées comme du code.
  - En-tête : `version`, `engine` (version du moteur), `mode` (doit valoir `KIWI` : une règle Arena ou ARAM classique est refusée), `patch`, `reviewedAt`, `validation`.
  - Pour chaque augment :
    - `base` : tier éditorial hors contexte ;
    - `requires` : conditions de déclenchement ;
    - `benefits` : mécaniques qui renforcent l'effet ;
    - `orientation` : dégâts, résistance, soutien, mobilité ;
    - `combos` et `conflicts` : autres augments, positifs ou négatifs ;
    - `note`.
- **Jeux de règles**
  - `rules/editorial.v1.json` : base relue publiée avec NEX. **Vide à ce jour** : aucun augment ne reçoit de note inventée, tous restent `?` (« non évalué »).
  - Édition locale : base saisie par le joueur dans NEX, marquée « édition locale ».
  - `rules/fixtures.v1.json` : **données d'essai** pour les tests et l'aperçu « DÉMO ». Jamais appliquées à une vraie partie. Ce n'est pas un catalogue évalué.
- **Validation des conseils**, affichée avec chaque note : `fixture`, `local_editorial` ou `editorial`.
- **Confiance d'identification**, distincte de la validation : `exact`, `approx` ou `ambiguous`.
- **Rareté du jeu** (Argent, Or, Prismatique) : affichée, mais jamais utilisée dans la note.

## 4. Moteur de notation (v1)

Le calcul est déterministe : même entrée, même sortie, sans aucun aléa.

| Élément | Valeur |
| --- | --- |
| Base éditoriale | S+ 95, S 85, A 72, B 60, C 46, D 32 |
| Condition de déclenchement absente / partielle / remplie | −18 / −6 / +3 |
| Mécanique renforcée centrale / présente | +4 / +2 (−4 une seule fois si aucune) |
| Orientation du joueur cohérente / contraire | +4 / −4 |
| Combo avec un augment confirmé / incompatibilité | +5 / −12 |
| Plafonds | bonus +12 au total, malus −24 au total |
| Seuils absolus | S+ ≥ 90, S ≥ 80, A ≥ 67, B ≥ 54, C ≥ 40, sinon D |
| Meilleure affinité | au moins deux cartes notées et un écart ≥ 6 points, sinon aucune |

- **Pas de double comptage** : une mécanique déjà comptée comme condition n'est pas recomptée comme bonus. Pour la portée, seule celle du champion compte (pas celle des objets).
- **Tiers absolus** : trois choix moyens restent B ou C. La meilleure des trois n'est pas promue.
- **Raisons** : les deux contributions les plus fortes, par exemple « compatible avec tes immobilisations » ou « peu de synergie avec ton champion et ton build ».
- **Statuts** :
  - augment identifié sans règle : `not_evaluated` (`?`) ;
  - carte non identifiée ou absente du catalogue de ce patch : `unknown` (`?`) ;
  - un augment inconnu ne reçoit jamais D.

**Profil du champion** (`nex_mayhem::profile`) : 13 mécaniques notées 0, 1 ou 2.
- Profil heuristique dérivé de Data Dragon : étiquettes, portée, ressource, mots-clés des textes anglais des compétences (« stun », « root », « shield », « heal », « on-hit »...). Il est signalé comme heuristique.
- Un profil édité le remplace quand il existe.
- Les objets connus ajoutent des mécaniques d'après leurs étiquettes Data Dragon (deux objets au plus comptent pour « central »).

## 5. Identification et cycle de vie

- **Lecture** : bande horizontale de la zone client du jeu (15-85 % en largeur, **20-65 % en hauteur**), copiée seulement quand le jeu est au premier plan. OCR local dans la langue du client.
  - Mesuré sur les trois phases réelles : cette bande lit les 9 titres en 38-41 ms.
  - La zone 10-90 % ne renvoie **aucune ligne** sur les mêmes images : l'OCR Windows échoue sur une zone trop chargée.
  - Aucune image n'est conservée ni envoyée. Aucune lecture de la mémoire du jeu.
  - Une ligne est un titre si elle correspond exactement à un nom du catalogue (français ou anglais, sans accents ni ponctuation).
  - Une correspondance approchée n'est retenue que si la ressemblance est ≥ 0,86, avec un écart ≥ 0,10 sur le deuxième nom.
  - Un titre peut tenir sur deux lignes alignées.
  - Seuls comptent les titres alignés sur une même ligne horizontale et répartis sur au moins deux colonnes.
- **Phase de choix** : elle commence quand au moins deux titres sont lus. Elle est vérifiée à l'écran, jamais déduite d'une liste de niveaux.
- **Versions** : toute modification des cartes (relance, nombre de cartes, contexte) crée une nouvelle version. Une note calculée pour une version antérieure est refusée.
- **Masquage**
  - après deux lectures consécutives sans carte ;
  - à l'expiration (5 s sans confirmation pour la lecture d'écran, 10 min pour la saisie manuelle) ;
  - immédiatement à la perte de focus du jeu, à la fin ou au changement de partie.

## 6. Overlay, raccourcis, réglages

- Les badges sont dessinés dans la fenêtre d'overlay existante (une seule WebView, aucune par carte).
  - En mode jeu, ils ne prennent pas le focus et laissent passer les clics : cartes et relances restent utilisables.
  - NEX n'effectue aucun clic, aucun choix et aucune relance.
- **Écusson SVG** : la lettre reste lisible sans la couleur.

  | Note | Couleur | Sens |
  | --- | --- | --- |
  | S+ | doré | synergie exceptionnelle dans ce contexte |
  | S | violet | excellente synergie |
  | A | bleu clair | très bon choix |
  | B | vert | choix correct |
  | C | orange | choix situationnel ou peu adapté |
  | D | rouge | faible intérêt dans ce contexte |
  | ? | gris | augment non identifié ou pas encore évalué |

  - Lecture approchée : marque « ≈ ».
  - Meilleure affinité : halo doré discret, seulement si elle est nette.
- **Raccourcis**
  - `Ctrl+Alt+A` : lecture des cartes. C'est une assistance déclenchée par le joueur, pas une détection automatique.
  - `Ctrl+Alt+D` : panneau de détail (raisons, confiance de lecture, validation, source, version des règles).
- **Lecture après une montée de niveau** : réglage activé par défaut, **inactif en mode Eco**. Les cartes sont lues pendant 12 s. La présence des cartes est vérifiée à l'écran, jamais déduite d'une liste de niveaux.
- **Session de lecture**
  - une lecture toutes les ~800 ms, un seul traitement à la fois ;
  - une image inchangée ne relance pas l'OCR ;
  - la session est prolongée tant que les cartes sont visibles, 120 s au maximum ;
  - le moteur OCR est libéré en fin de session.
- **Réglages** (page *Overlays*) : affichage des badges, lecture automatique, position (en hauteurs de titre), taille, opacité, retour aux valeurs par défaut, aperçu « DÉMO ».
- **Mode manuel** (page *ARAM Mayhem*) : champion, trois cartes recherchées par nom (français ou anglais), comparaison immédiate, « Afficher sur l'overlay ». L'affichage est marqué « saisie manuelle » et reste distinct de la lecture.
- **Augments confirmés** : bouton « J'ai choisi celle-ci » sur la page pendant la partie. C'est la seule source des augments possédés.
- **Version web** : catalogue et notes via le backend NEX, avec le même moteur Rust et les règles publiées seulement. Ni lecture d'écran, ni overlay, ni édition locale.

## 7. Mesures (build release, machine de référence, 8 novembre 2026)

Overlay seul (`nex.exe --tray --overlay-game`), tous les processus NEX comptés (Rust et WebView2). CSV : `docs/perf/mayhem-*.csv`.

| Situation | RAM privée résidente | CPU moyen |
| --- | ---: | ---: |
| Overlay ouvert, sans lecture (6 × 5 s) | 90,7 MiB | 0,00 % |
| Pendant la lecture, cartes visibles (12 × 5 s) | 91,2 MiB (max 94,1) | 0,00 % |
| Après la disparition des cartes (4 × 5 s) | 89,7 MiB | 0,00 % |

- **Identification** (copie et OCR) : 49 à 53 ms.
- **Notes** : 39 à 113 µs.
- Objectif « overlay seul < 200 MiB » respecté.
- Le CPU, échantillonné toutes les 5 s, ne voit pas les pointes brèves d'OCR.
- Le délai entre l'événement et l'affichage dans la WebView n'est pas instrumenté : la cible de 500 ms est tenue sur l'identification et les notes, mais pas mesurée jusqu'au rendu.

## 8. Données de calibration

Mesuré sur la partie réelle en 2560×1440 :
- titres alignés à y = 0,404 (hauteur 0,014) ;
- centres des cartes à x = 0,309, 0,500 et 0,691 ;
- cadres des cartes de y = 0,18 à 0,665 ;
- description terminée vers y = 0,50 ;
- boutons de relance vers y = 0,71.

Le badge se place dans la zone libre basse de la carte : centre à environ 11,8 hauteurs de titre sous le haut du titre (y ≈ 0,57). Il ne masque ni le nom, ni l'effet, ni le bouton de relance. Décalage, taille et opacité se règlent en mode configuration.

## 9. Données publiques arammayhem.com

Fournisseur `ArammayhemExport` (`nex_mayhem::provider`), derrière le trait `MayhemDataProvider` : chaque fournisseur déclare ses capacités, et NEX n'affiche que ce qui est déclaré.

### 9.1 Audit (8 novembre 2026)

| Élément examiné | Constat | Décision |
| --- | --- | --- |
| Export `https://arammayhem.com/data/v1/` : `index.json`, `latest/{augments,champions,combos,items}.json`, fichiers par patch | `schemaVersion` 1, licence CC BY 4.0, attribution « Data: arammayhem.com », une `releaseId` par publication. Pick rate, rang par pick rate (ex æquo partagés), variation par rapport au patch précédent, présence (`new`, `continuing`), patchs d'introduction et de retrait. Combos par champion avec étiquettes éditoriales. | Importé : augments, champions, combos. `items.json` non utilisé (aucune capacité « builds »). |
| Périmètre déclaré par la source | « Pick rates only » : taux de victoire, tiers et rangs fondés sur les victoires non publiés. Échantillon limité, pas des données mondiales. | Repris tel quel dans l'interface. |
| Pages du site (tier lists, fiches de build) et serveur MCP | Tiers et taux de victoire affichés, « All rights reserved ». | **Non importés**, ni recopiés à la main. Le serveur MCP n'est pas exécuté : ni Node, ni MCP, ni modèle d'IA sur le PC du joueur. |

### 9.2 Capacités déclarées

| Capacité | Disponible |
| --- | --- |
| Catalogue (identifiants, noms, rareté) | oui |
| Popularité (pick rate, rang par pick rate) | oui |
| Combos avec étiquettes éditoriales | oui |
| Historique (fichiers par patch) | oui (non exploité à ce jour) |
| Tiers globaux des augments | **non** |
| Tiers champion–augment | **non** |
| Builds | **non** |

### 9.3 Import, provenance, cache

- **Validation** avant tout usage :
  - `schemaVersion` 1 et licence CC BY 4.0 dans chaque fichier, sinon refus ;
  - même `releaseId` dans l'index et les trois fichiers, sinon refus (publication en cours de remplacement) ;
  - identifiants limités aux caractères alphanumériques, `_`, `-` et `!` ; liens limités à `https://arammayhem.com/` ;
  - valeurs hors bornes ignorées (pick rate hors 0-100 %).
- **Provenance** jointe au jeu de données : fournisseur, URL, `releaseId`, patch de la source, date de publication du patch, patch de comparaison, date des statistiques et son origine (`release` ou estimée), date de récupération, licence, attribution, périmètre déclaré.
- **Cache** (`mayhem:dataset:arammayhem:v2`, 12 h, application et backend) :
  - seul l'export brut, validé en entier, est enregistré : remplacement atomique ;
  - en cas de panne ou de contenu invalide, la dernière version valide est servie avec sa vraie date de récupération ;
  - la correspondance avec le catalogue Riot est refaite à chaque lecture : un nouveau patch du client est pris en compte sans attendre la source.

### 9.4 Correspondance des identifiants

- **Exacte** : nom anglais normalisé identique à un seul augment du catalogue Riot `KIWI`.
- **Alias contrôlés** (`ALIASES`, vérifiés à la main le 8 novembre 2026) : les trois quêtes, que la source préfixe par « Quest: ». Un alias n'est retenu que si la clé Riot existe et que la rareté concorde.
- **Ambiguë** : plusieurs augments Riot du même nom, ou deux identifiants de la source vers la même clé (collision). Aucune correspondance n'est retenue.
- **Non reliée** : absent du catalogue Riot du patch.
- **Patch** : la source numérote `26.x`, le client `16.x` (même saison). Tout écart est signalé, jamais corrigé.

**Couverture mesurée** (publication `website:20261108_104035:3df69243a697`, patch 26.22, statistiques du 7 novembre 2026, catalogue Riot 16.22) :

| Mesure | Valeur |
| --- | ---: |
| Augments dans l'export | 213 |
| Reliés exactement / par alias | 207 / 3 |
| Ambigus | 0 |
| Non reliés (`void_immolation`, `double_defense`, `rabble_rousing`) | 3 |
| Augments du catalogue Riot (241) sans donnée de la source | 31 |
| Champions | 173 |
| Combos | 666 |
| Combos entièrement dans le pool actuel | 424 (147 champions) |
| Combos citant un augment absent du pool actuel | 242 (41 identifiants absents de l'export et du catalogue Riot) |

Exemples d'augments Riot sans donnée de la source : Earthwake, Flashy, Transmute: Gold, Upgrade Sundered Sky.

Étiquettes des 424 combos du pool (un combo peut en porter plusieurs) : aucune 206, `strong` 95, `god` 63, `trap` 27, `blackTech` 24, `entertainment` 21, `bug` 2 (Elise avec `dashing`, Quinn avec `outlaws_grit`).

**Écarts signalés par l'import** : `clown_college`, `void_immolation` et `rabble_rousing` sont marqués retirés (patchs 26.17, 26.18, 26.12) mais encore mesurés au patch 26.22. L'interface les affiche comme « écart à vérifier ».

### 9.5 Usage dans NEX

**Hiérarchie de la note d'une carte**

1. Tier champion–augment de la source : **indisponible** (non publié sous licence).
2. Règles NEX : base éditoriale publiée, puis édition locale. **C'est la seule source des notes S+ à D.**
3. Tier global de la source : **indisponible** (non publié sous licence).
4. Sinon : `?` (« non évalué »).

La popularité et les combos sont du **contexte**. Ils n'entrent jamais dans le calcul d'une note.

- **Popularité**
  - Affichage : « Choisi dans X % des cas (pick rate de la source) · rang N sur 213 (tous les augments de l'export) », avec la variation, le patch et la date des statistiques.
  - Le rang porte sur tout l'export, pas sur une rareté.
  - Mention systématique : une fréquence n'est ni une qualité ni une probabilité de victoire.
  - Un augment peu choisi ne reçoit jamais de note basse pour cette raison.
- **Combos** (pour le champion choisi), triés du plus concret au plus incertain :
  1. « Combo documenté avec cet augment seul » ou « Combo réalisable avec tes augments » (tous les autres augments sont confirmés) ;
  2. « Interaction à vérifier pour ce patch » (étiquette `bug`) ;
  3. « Projet de combo », par nombre d'augments manquants, avec « tirages incertains ».
- **Combos historiques** : un combo qui cite un augment absent du pool actuel n'est pas réalisable. Il est masqué et compté à part.
- **Affichage des combos** : 3 combos visibles, puis « Voir N autres » ; 12 au plus par carte, total indiqué. Aucun bonus de note : la source ne publie ni conditions ni validation pour ces combos.
- **Où ils apparaissent** :
  - page *ARAM Mayhem* :
    - comparaison manuelle ;
    - détail d'un augment, avec les champions pour lesquels la source documente un combo contenant cet augment ;
    - onglet « Champions (popularité) » : classement par pick rate et fiche champion (combos du pool groupés par étiquette ; tiers et builds signalés comme indisponibles) ;
    - onglet « Sources et crédits » : provenance, capacités, couverture, écarts ;
  - overlay : panneau de détail (`Ctrl+Alt+D`), deux lignes de contexte par carte au plus.
- **Crédit** affiché partout où une donnée de la source apparaît : « Data: arammayhem.com · CC BY 4.0 », avec un lien vers la licence et la mention « non approuvé par Riot Games ».

### 9.6 Cas de référence

Vérifiés sur l'extrait daté `crates/nex-mayhem/tests/fixtures/arammayhem-2026-11-08.json` : tous les augments, combos et champions limités à Ryze, Yasuo, Sett, Elise et Quinn.

| Cas demandé | Résultat NEX | Raison |
| --- | --- | --- |
| Yasuo — Upgrade Death's Dance « S− / A+ » | `?`. Contexte : 25,7 % des cas, rang 49 sur 213. Aucun combo de la source pour Yasuo avec cet augment. | Les tiers champion–augment ne sont pas publiés sous licence. Ils ne sont pas reproduits. |
| Ryze — Overflow face à Transmute: Prismatic | `?` / `?`. Contexte : Overflow 10,2 % (rang 133), avec un combo de la source « Overflow seul » étiqueté `god` pour Ryze ; Transmute: Prismatic 60,5 % (rang 1), aucun combo pour Ryze. | Aucune base éditoriale relue. La popularité n'est pas un tier : le rang 1 ne devient pas une note. L'étiquette `god` reste une information, sans bonus : elle n'a ni conditions ni validation publiées. |
| King Me (prismatique) « D » | `?`. Contexte : 4,1 % des cas, rang 187 sur 213. | Une faible popularité ne devient jamais D. La rareté du jeu n'entre pas dans la note. |
| Ryze + ADAPt + Mind to Matter | ADAPt reste `?`. Combo 9 « ADAPt seul » (`god`) documenté ; combo 1082 « ADAPt + Mind to Matter » réalisable quand Mind to Matter est confirmé ; projets plus lointains ensuite ; combos historiques masqués. | Information sans bonus de note. |

**Parcours complet vérifié** (version web, backend local, 8 novembre 2026) : données vérifiées → Ryze → Mind to Matter confirmé → ADAPt, Transmute: Prismatic, King Me → popularité, combos et crédits par carte → écussons `?` (aucune base éditoriale). Le placement des badges sur l'overlay et le panneau de détail ont été validés séparément (§ 2).

### 9.7 Ce qui n'est pas branché

- **Tiers et taux de victoire** de la source : non licenciés, absents de NEX.
- **Builds** de la source : capacité absente, rien n'est affiché.
- **Historique par patch** : disponible chez la source, non exploité.
- **Base éditoriale NEX** : toujours vide. Toutes les cartes réelles restent `?` tant qu'aucune règle n'est relue et publiée, ou saisie en édition locale.
