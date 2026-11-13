# Prompt — fonctionnalités à ajouter à NEX

Ce fichier est un **prompt prêt à coller**. Il décrit ce que l'application concurrente
(Invade 0.3.7) affiche dans l'enregistrement d'écran du 12 novembre 2026, ce que NEX fait
déjà aujourd'hui, et ce qu'il reste à construire.

Tu peux le coller en entier, ou ne coller qu'une seule section « Lot » : chaque lot est
autonome.

> **Fait le 13 novembre 2026 :** lots **A** (historique des LP), **B** (badges et rang de
> partie), **D** (onglet Or), **E** (Chronologie) et **G** (filtres, jours, session). Voir `src/domain/badges.ts`, `src/domain/lp.ts`,
> `src/features/profile/LpCard.tsx` et la table `rank_snapshots` du backend.

---

## 0. Contexte à donner à l'agent (à coller en tête)

> Tu travailles sur **NEX**, une application compagnon League of Legends pour Windows :
> Tauri 2 + Rust (`src-tauri/`), React + TypeScript (`src/`), SQLite, et un backend Rust/axum
> séparé (`backend/`, port 8787) qui détient la clé Riot. Le dépôt n'est pas sous git.
> L'interface est **entièrement en français**.
>
> Règles non négociables :
> - La clé Riot ne vit que dans `backend/.env`. Jamais dans le code client, jamais dans une
>   réponse. Ne lis ni n'utilise `C:\Users\Farouk\.env`.
> - Aucune donnée inventée : si une valeur manque, affiche « — » et explique pourquoi.
>   Chaque carte agrégée porte une note d'échantillon (« Sur les N parties chargées… »).
> - Pas de scraping, pas d'import de tier lists ou de win rates d'autres sites : NEX calcule
>   les siens à partir des parties qu'il collecte (`backend/src/analytics.rs`).
> - Clé de développement Riot : ~100 requêtes / 2 min. Toute fonctionnalité doit dire combien
>   de requêtes elle coûte et mettre en cache côté backend.
> - Une nouvelle commande Tauri doit être déclarée aux **trois** endroits :
>   `src-tauri/build.rs` (`COMMANDS`), `src-tauri/src/lib.rs` (`generate_handler!`) et
>   `src-tauri/capabilities/main-window.json` (`allow-<cmd>`), avec un garde
>   `require_main` / `require_main_or_overlay`.
> - Le CSP est dans `src-tauri/tauri.conf.json`, à modifier dans `app.security.csp` **et**
>   `devCsp`.
> - Avant toute compilation lourde ou redémarrage de l'app, vérifier
>   `Get-Process "League of Legends"` : on ne recompile pas pendant une partie.
> - `npx tsc --noEmit` doit passer, et `npx vitest run` aussi. Toute logique de calcul va dans
>   `src/domain/` avec un test à côté.
> - Suppressions : corbeille, jamais de suppression définitive.

---

## 1. Ce qu'Invade montre et ce que NEX a déjà

| Écran / bloc d'Invade | État dans NEX |
|---|---|
| Courbe d'historique des LP, ±LP par partie | **fait** (lot A) ; record et saison passée non |
| Bilan de la dernière session (V/L, ±LP, durée) | **fait** (lot G) |
| Historique groupé par jour avec bilan du jour | **fait** (lot G) |
| Badges de partie (MVP, ACE, 3e, Lane gagnée, Meilleure vision…) | **fait** (lot B) |
| Tableau des scores : % des dégâts d'équipe, dégâts subis, or/min, score par joueur | partiel |
| Onglet « Or » : courbes Or/XP/CS de chaque joueur, avance d'équipe, curseur | partiel |
| Onglet « Chronologie » : combats d'équipe détectés, gagné/perdu, score courant | partiel |
| Onglet « Build » : sélecteur de joueur, page de runes complète, bloc « Détails » | partiel |
| Filtres d'historique (file + compteur, champion, bande V/D) | **fait** (lot G) |
| Comparaison des métriques à une **cible de rang** (« Cible 8,4 », « vs Maître · Bas ») | partiel |
| Multi-comptes avec sélecteur | **absent** |
| Mettre une partie en favori (étoile) | **absent** |
| Tier list champions par rôle / rang / patch | déjà là (`Builds & tier lists`) |
| Matchups fort/faible contre, avec ta propre ligne | déjà là (`Matchups & draft`) |
| « A joué avec » sur 40 parties | déjà là (`Souvent en même équipe`) |
| Favoris joueurs / champions | déjà là |
| Catalogue d'overlays (11 chez Invade, réglables un par un) | partiel (5 widgets) |
| Clips automatiques des temps forts | partiel (`Enregistrements`) |

---

## Lot A — Historique des LP (priorité 1)

**Ce qu'Invade affiche.** Sur l'accueil, une mini-courbe « +81 LP en 10 jours » avec les trois
derniers deltas (−13, ±0, +30). Sur le profil, un bloc « Historique des PL » avec bascule
Solo/Duo – Flex, la courbe sur la période, « +81 LP · depuis le 2 nov. · 7 changements », une
ligne de palier (« Maître+ ») en fond, « Record : Maître 30 LP » et « Saison passée :
Diamant ». Chaque ligne d'historique porte son « +30 LP » / « −13 LP » / « ±0 LP », et chaque
en-tête de jour porte le bilan du jour (« 4 V 6 D · −31 LP »).

**Où NEX en est.** `MatchSummary.lpDelta` existe déjà mais vaut toujours `null` sur données
réelles, et `DashboardPage.tsx` l'assume en toutes lettres : « Variations de LP : non fournies
par l'historique Riot, elles exigeront des relevés enregistrés. » Rien n'est stocké.

**À construire.**
1. Table SQLite `rank_snapshots(platform, puuid, queue, tier, division, lp, wins, losses, at_ms)`,
   côté backend (`backend/src/store.rs`). Un relevé n'est inséré que si le trio
   (tier, division, lp) ou le couple (wins, losses) a changé depuis le dernier.
2. Relevé déclenché : au démarrage de l'app, à l'ouverture du dashboard (TTL 5 min), et à la
   fin d'une partie détectée par le client League. Coût : 1 requête league-v4 par relevé.
3. Attribution du delta à une partie : on rapproche un relevé de la partie classée la plus
   récente terminée avant lui. Si deux parties sont tombées entre deux relevés, le delta
   reste `null` pour les deux — **ne pas répartir au hasard**.
4. Le client League (LCU) donne aussi le gain/perte de fin de partie : à utiliser en priorité
   quand il est disponible, le relevé league-v4 servant de filet.
5. Composant `LpChart` dans `src/features/profile/`, et une version compacte dans la carte de
   rang du dashboard.
6. Honnêteté : tant qu'il n'y a pas deux relevés, afficher « Pas encore d'historique : NEX
   enregistre ton rang à partir d'aujourd'hui, Riot ne fournit pas le passé. » Pas de courbe
   reconstituée.
7. « Saison passée » vient de league-v4 (entrées de la saison précédente) si disponible,
   sinon le bloc est masqué.

**Tests.** `src/domain/lp.ts` + `lp.test.ts` : attribution d'un delta, cas « deux parties
entre deux relevés », cas « changement de palier » (Diamant I 95 LP → Maître 10 LP = +15 et
non −85).

---

## Lot B — Badges et classement de partie (priorité 1, peu coûteux)

**Ce qu'Invade affiche.** Sous les objets de chaque ligne d'historique : « Lane gagnée », « Le
plus de dégâts », « Meilleure vision », « Le plus de contrôles », « Triple élimination »,
« Premier sang », « Objectifs », « Le plus encaissé ». Dans l'anneau de score : `MVP`, `ACE`,
ou le rang du joueur dans la partie (`3e`, `8e`, `10e`).

**Où NEX en est.** Il y a l'anneau « Score NEX » (`src/domain/nexScore.ts`) mais aucun badge
et aucun classement relatif aux dix joueurs.

**À construire.** Un module `src/domain/badges.ts` qui prend un `MatchDto` et rend, pour
chaque participant, la liste de ses badges et son rang.
- `MVP` = meilleur score NEX de l'équipe gagnante ; `ACE` = meilleur score de l'équipe
  perdante ; sinon rang 1..10 sur les dix joueurs.
- `Le plus de dégâts` / `Le plus encaissé` / `Meilleure vision` / `Le plus de contrôles`
  (`timeCCingOthers`) : maximum sur les dix joueurs, décerné seulement si l'écart avec le
  deuxième dépasse 10 % (sinon le badge ne veut rien dire).
- `Premier sang` : `firstBloodKill`. `Triple/Quadra/Pentakill` : `largestMultiKill`.
- `Objectifs` : plus de dégâts aux objectifs de la partie.

**Champs à ajouter au DTO.** `ParticipantDto` (`src/platform/api.ts`, `src/platform/contracts.ts`)
a déjà `damageTaken` et `largestMultiKill`, mais **pas** `firstBloodKill`, `timeCCingOthers`,
`damageDealtToObjectives`, `damageDealtToTurrets`, `largestKillingSpree` ni
`detectorWardsPlaced`. Il faut les exposer dans `backend/src/normalize.rs`, les ajouter au
contrat des deux côtés, et les rendre optionnels (`| null`) pour que les parties déjà en cache
et celles lues dans le client League restent lisibles.
- `Lane gagnée` : écart d'or à 15:00 positif **et** adversaire direct identifié — n'existe donc
  que si la timeline est chargée, et seulement en Faille. Réutiliser `goldDiffAt15` de
  `src/domain/fromMatch.ts`.
- Tout badge non calculable est **absent**, pas affiché en gris.

**Intégration.** `MatchHistoryRow` (ligne d'historique) et `RecentMatches` (dashboard).
Attention : le calcul ne doit tourner qu'une fois par partie (`useMemo`), la liste peut
afficher 40 lignes.

**Tests.** `badges.test.ts` : égalité parfaite entre deux joueurs → pas de badge ; remake →
aucun badge ; ARAM → pas de « Lane gagnée ».

---

## Lot C — Tableau des scores enrichi (priorité 2)

**Ce qu'Invade affiche.** Colonnes : Joueur · KDA · Dégâts · Subis · Or · CS · Vision ·
Objets · Score. Chaque joueur a son pourcentage des dégâts de l'équipe (« 13 % 24,3k ») avec
une barre, ses dégâts subis avec barre, son or **et** son or/min, ses CS **et** ses CS/min,
ses balises posées/détruites, son badge, son anneau de score et son rang. L'en-tête d'équipe
porte « Victoire · Côté bleu », les compteurs d'objectifs, le bilan `46 / 57 / 93` et
`87,2k PO`. Chaque ligne se déplie.

**Où NEX en est.** `src/features/profile/MatchDetail.tsx` → `TeamTable` a déjà : KDA,
dégâts + barre (relative au maximum de la partie), or, CS + CS/min, vision + balises, objets,
objectifs d'équipe et bans. Manquent : le **pourcentage** des dégâts de l'équipe, la colonne
**dégâts subis**, l'**or/min**, le **score + rang par joueur**, et le **dépliage par ligne**.

**À construire.**
1. Ajouter les colonnes « Subis » et le `%` d'équipe sur les dégâts (la barre devient relative
   à l'équipe, pas à la partie — c'est plus lisible).
2. Ajouter l'anneau de score et le badge de chaque joueur (Lot B).
3. Dépliage d'une ligne : runes complètes, sorts, ordre d'achat si la timeline est là, et le
   bloc « Détails » du Lot E.
4. Bilan d'équipe dans l'en-tête : `kills / deaths / assists` cumulés et or total.

---

## Lot D — Onglet « Or » : courbes de toute la partie (priorité 2)

**Ce qu'Invade affiche.** Un graphe avec dix courbes (une par joueur), une bascule
**Or / XP / CS**, un **curseur temporel** qui suit la souris (« 7:00 · Votre équipe −3,2k or »),
la liste des dix joueurs à droite avec leur valeur à l'instant du curseur et le total de chaque
équipe (« Votre équipe 29,3k / Équipe ennemie 32,6k »), une aire « Avance de l'équipe » en bas
avec des losanges aux moments clés, et « Cliquez sur un joueur pour épingler sa courbe ».

**Où NEX en est.** `CurvesPanel` dans `MatchDetail.tsx` trace **deux** courbes : ton écart d'or
contre ton adversaire direct, et tes CS contre les siens. La timeline contient déjà les frames
de **tous** les participants (`perMinuteSeries` ne lit que le tien) : il n'y a donc **aucune
requête supplémentaire** à faire, c'est de l'affichage pur.

**À construire.**
1. Étendre `perMinuteSeries` (ou ajouter `allSeries(t)`) pour rendre or / XP / CS de chaque
   participant.
2. Un composant de graphe multi-séries avec curseur. `src/ui/LineChart.tsx` existe mais ne
   gère ni le survol ni dix séries : soit l'étendre, soit écrire `MultiLineChart` à côté.
   Couleurs : bleu/rouge par équipe, opacité réduite hors joueur épinglé ; **jamais** dix
   couleurs distinctes, c'est illisible.
3. Aire « avance d'équipe » = somme de l'or de ton équipe − somme de l'équipe adverse.
4. Accessibilité : le graphe garde un `aria-label` et une table de valeurs lisible par lecteur
   d'écran (ce que fait déjà `LineChart`).
5. Mayhem (file 2400) : pas de timeline, l'onglet reste masqué comme aujourd'hui.

---

## Lot E — Onglet « Chronologie » narratif (priorité 2)

**Ce qu'Invade affiche.** Pas une liste d'événements bruts, mais un **récit de combats** :

```
14:34  ⬤  A détruit Tourelle   Milieu · intérieure
14:40  ◯  Escarmouche  0–2  perdu · 1 s
          Tué par Lux  [Double élimination]
15:55  ◯  Combat d'équipe  5–3  gagné · 15 s        37 – 52   −2,8k
   +4s   A aidé à tuer Sett
   +5s   A aidé à tuer Graves
   +15s  A aidé à tuer Yuumi
```

avec, en haut, une rangée d'icônes de champions pour filtrer sur un joueur (« Toute la partie »
par défaut), et à droite le score courant de la partie et l'écart d'or au moment du combat.

**Où NEX en est.** `CurvesPanel` a un bloc « Événements clés » : une liste plate de tes
éliminations/morts et des monstres épiques, plafonnée à 40 lignes. Pas de regroupement, pas de
filtre, pas de score courant.

**À construire.** `src/domain/fights.ts` :
1. Regrouper les `champion_kill` dont les horodatages sont espacés de moins de ~10 s **et**
   dont les positions sont proches (la timeline fournit `position.x/y`) en un combat.
2. Qualifier : 2 morts ou moins = `Escarmouche`, au-delà = `Combat d'équipe`. Résultat =
   `gagné` / `perdu` / `nul` selon les morts de chaque côté. Durée = dernier − premier.
3. Hors combats : tourelles, inhibiteurs, dragons, barons, hérauts, larves — avec leur voie et
   leur type quand la timeline les donne (`buildingType`, `laneType`, `towerType`).
4. Score courant cumulé et écart d'or au moment du combat (frames de timeline).
5. Filtre par joueur : ne garder que les lignes où il tue, aide ou meurt.
6. Traduction française des types : `OUTER_TURRET` → « extérieure », `MID_LANE` → « Milieu »,
   etc. Un type inconnu s'affiche tel quel plutôt que d'être masqué.

**Tests.** `fights.test.ts` : deux morts à 30 s d'écart = deux escarmouches ; cinq morts en 8 s
= un combat d'équipe ; une partie sans mort = aucune ligne de combat mais les objectifs restent.

---

## Lot F — Onglet « Build » enrichi (priorité 3)

**Ce qu'Invade affiche.** Un sélecteur de joueur (dix icônes), la **page de runes complète** —
l'arbre entier avec les runes non choisies grisées, pas seulement les quatre retenues —, les
objets finaux, les sorts d'invocateur, et un bloc **« Détails »** :

| Ligne | Source Riot |
|---|---|
| Balises · 12 posées · 7 détruites · 0 de contrôle | `wardsPlaced`, `wardsKilled`, `detectorWardsPlaced` (le DTO n'a aujourd'hui que `controlWardsBought`) |
| Contrôle de foule · 1 s | `timeCCingOthers` |
| Dégâts aux objectifs · 30,1k · 7,7k aux tours | `damageDealtToObjectives`, `damageDealtToTurrets` |
| Plus longue série d'éliminations · 6 | `largestKillingSpree` |
| Plus grand multi-kill · Double élimination | `largestMultiKill` |
| Avance à 15 min · +1,9k PO · +1,0k XP · +13 CS | timeline, frame 15 |

Les six lignes du tableau demandent les champs du Lot B à ajouter au DTO.

**Où NEX en est.** `RunesPanel` n'affiche que les runes choisies ; `BuildPanel` a l'ordre
d'achat et l'ordre des compétences (deux choses qu'Invade n'a pas, à garder). Pas de sélecteur
de joueur, pas de bloc Détails.

**À construire.** Le sélecteur de joueur (qui doit piloter les trois onglets Build, Or et
Chronologie), l'arbre de runes complet depuis `catalog.runes`, et le bloc Détails ci-dessus.
« Avance à 15 min » étend `goldDiffAt15` à l'XP et aux CS.

---

## Lot G — Historique : filtres, groupement, session (priorité 2)

**Ce qu'Invade affiche.**
- Onglets de file **avec compteur sur l'échantillon** : `Tout` · `Solo/Duo 3` · `Flex 1` ·
  `Partie normale 2` · `ARAM 8`, plus un filtre par champion et un tri « Par date ».
- Une ligne de résumé : « 15 parties · 6 V 9 D 40 % · 2,51 KDA · 4,4 CS/min · 38 score moyen »
  suivie d'une **bande de points verts/rouges** (une partie = un point).
- Un groupement **par jour** : « Hier · 2 V 2 D · +30 LP », « dimanche 8 novembre · 4 V 6 D ·
  −31 LP ».
- Sur l'accueil : « **Dernière session** · Hier · 1 W 1 L · ±0 LP · 2 parties · 52:03 ».

**Où NEX en est.** `ProfilePage` a un `Segmented` de files sans compteur, et un simple
« N parties affichées ». Pas de filtre champion, pas de groupement, pas de session.

**À construire.**
1. Compteurs par file, calculés sur les parties déjà chargées (donc sans requête).
2. Filtre par champion (liste déduite de l'échantillon).
3. Groupement par jour avec bilan du jour (le ±LP du jour arrive avec le Lot A ; sans lui,
   n'affiche que V/D).
4. Bande de points + ligne de résumé.
5. `src/domain/sessions.ts` : une session = des parties séparées de moins de 2 h. Rendre la
   dernière session (date, V/L, nombre de parties, temps de jeu cumulé, ±LP si connu).

**Tests.** `sessions.test.ts` : coupure à 2 h, parties d'une seule session, aucune partie.

---

## Lot H — Métriques comparées à une cible de rang (priorité 3)

**Ce qu'Invade affiche.** « Score Invade 41 · 9 V 11 D · 45 % · 20 dernières parties », et pour
chaque métrique la valeur, le delta, une courbe, et une **cible** : « CS/min 7,1 −1,3 ·
Cible 8,4 », « KP 55 % +8 · Cible 47 % ». L'en-tête précise la référence : « vs Maître · Bas »
(ton rang, ton rôle).

**Où NEX en est.** Les métriques du dashboard comparent la **fenêtre récente à la fenêtre
précédente** (« Variation : 20 dern. vs 20 préc. »), ce qui est une autre question — à garder.
Il manque la référence externe.

**À construire.** Le backend collecte déjà des parties (`backend/src/analytics.rs`,
`/v1/stats/*`). Ajouter `/v1/stats/baseline?tier=&role=&queue=` qui rend la médiane de CS/min,
KP, vision/min, KDA et or/min pour ce palier et ce rôle, **à partir des parties collectées par
NEX** — surtout pas d'un site tiers.

Garde-fous : afficher le nombre de parties derrière la cible, et masquer la cible sous un seuil
(par exemple 200 parties) plutôt que de montrer un chiffre fragile. Le libellé dit toujours
d'où vient la cible (« médiane Maître · Bas, sur 1 240 parties collectées par NEX »).

---

## Lot I — Multi-comptes (priorité 3)

**Ce qu'Invade affiche.** Un bouton « Comptes » en haut du profil qui liste les comptes du
joueur avec leur rang, et marque celui qui est « Connecté » (celui du client League ouvert).

**Où NEX en est.** Un seul compte lié (`settings.linkedRiotId` / `linkedPlatform`), posé par
« C'est mon compte ».

**À construire.** Remplacer le réglage par une liste `linkedAccounts: {riotId, platform}[]`
avec un compte actif, un sélecteur dans l'en-tête du profil et du dashboard, et la détection du
compte actuellement connecté via le client League. Migration : l'ancien réglage devient le
premier élément de la liste. Coût : 1 requête profil par compte affiché, mise en cache.

---

## Lot J — Overlays : catalogue et réglages (priorité 3, gros chantier)

**Ce qu'Invade propose.** Onze overlays classés en trois moments, chacun activable seul :

- **En jeu (7)** : Objectifs (timers *et* dragons obtenus) · Performances (ton rythme face à un
  rang cible) · Ordre d'achat (quoi acheter dès la première seconde) · Prochaine compétence ·
  Or du tableau des scores (l'or par voie quand Tab est enfoncée) · Optimisations (les plus
  choisies sur ton champion) · Timers de la minicarte (réapparition des inhibiteurs).
- **Sélection des champions (3)** : Runes et build importés · Chances de victoire de la draft ·
  Counters contre l'adversaire.
- **Écran de chargement (1)** : rang et forme de chaque joueur sur sa carte.

Et pour chaque overlay : une description, un aperçu avec bascule « Début / Milieu de partie »,
le mode d'affichage **Toujours / Sur Tab / Sur une touche** avec la touche à choisir, un
curseur de taille, et une position déplaçable en jeu.

**Où NEX en est.** Cinq widgets (`src/features/overlays/widgets.ts`) : chronomètre et stats,
timers d'objectifs, prochain objet, rappel de compétence, rappel de trinket, avec un éditeur de
disposition (`LayoutEditor.tsx`).

**À construire, par ordre de valeur.**
1. **Réglages par widget** : mode d'affichage (toujours / sur une touche), taille, position.
   C'est ce qui manque le plus et ça ne demande aucune donnée nouvelle.
2. **Overlay de sélection des champions** : runes et build conseillés, counters. Les données
   existent déjà (`/v1/stats/champion/{id}/build` et `/matchups`), la fenêtre de draft est
   nouvelle.
3. **Analyse à l'écran de chargement** : rang de chacun. Coût : 10 requêtes league-v4 en une
   fois — à mettre en cache et à rendre désactivable, c'est lourd pour une clé de dev.

**Interdits rappelés.** Aucune lecture de la mémoire du jeu, aucune injection, aucun choix
automatisé, aucun contournement d'anti-triche. Tout vient de la Live Client Data API et du LCU.

---

## Lot K — Détails d'interface qui coûtent peu (priorité 4)

- **Partie en favori** : une étoile sur l'en-tête du détail de match, stockée en local.
- **Dernière partie** : « Dernière partie il y a 18 h » dans l'en-tête du profil.
- **Record et saison passée** sous la courbe de LP (dépend du Lot A).
- **Champions · Récents / Maîtrise** : Invade bascule entre « parties récentes » et « maîtrise »
  (niveau, points, dernière partie). La maîtrise vient de `champion-mastery-v4`, que NEX
  n'appelle pas encore.
- **Diagnostic copiable** dans les paramètres : version, chemin du client League détecté,
  dernières erreurs — sans jamais inclure de mot de passe, de token de lockfile ni la clé Riot.
- **Mention légale** en pied des paramètres : NEX n'est pas approuvé par Riot Games.

---

## 2. Ordre conseillé

1. **Lot B** (badges) — tout est déjà en mémoire, c'est l'effet visuel le plus rapide.
2. **Lot A** (LP) — le plus gros manque ressenti, et il faut commencer à enregistrer tôt :
   chaque jour sans relevé est un jour de courbe perdu.
3. **Lot G** (filtres, jours, session) — pas de requête supplémentaire.
4. **Lot D** et **Lot E** (Or, Chronologie) — la timeline est déjà téléchargée, on n'en exploite
   qu'un dixième.
5. **Lot C** et **Lot F** (tableau des scores, build).
6. **Lot H**, **Lot I**, **Lot J**, **Lot K**.

## 3. Ce qu'il ne faut pas copier

- Les **clips automatiques** d'Invade supposent un encodage permanent en arrière-plan. NEX a
  déjà `Enregistrements` ; avant d'aller plus loin, mesurer le coût CPU/GPU en partie.
- Les **chiffres de tier list** d'Invade viennent de leur propre collecte massive. NEX ne doit
  ni les importer ni les imiter avec un échantillon trop mince : mieux vaut afficher
  « échantillon insuffisant » que de faux tiers.
- Le **nombre de parties** affiché par Invade (461k parties sur un champion) n'est atteignable
  qu'avec une collecte à leur échelle. Annonce toujours la taille réelle de l'échantillon de
  NEX.
