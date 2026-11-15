# Profil : statistiques par champion de la saison, et rangs des saisons passées

Référence : captures U.GG du profil « Katsuki Sama #EUW » (onglet Overview, carte
« Champion Stats », page « Champion Stats » complète, et le bandeau de badges S15 → S5
au-dessus du pseudo).

Ce document a été écrit **après avoir vérifié ce que les données de NEX permettent**.
Les trois pièces demandées ne sont pas de même difficulté : deux sont faisables
aujourd'hui, la troisième se heurte à une limite de l'API Riot. Lis la section 3 avant
de promettre quoi que ce soit à l'écran.

---

## 1. Carte « Champions de la saison » sur le profil

Une carte latérale listant les champions les plus joués, comme celle d'U.GG :

| ce que montre U.GG | source dans NEX |
| --- | --- |
| Icône + nom du champion | `MatchSummary.champion` + `ChampIcon` |
| KDA moyen (2.78) et détail 8.7 / 5.2 / 5.9 | `kills`, `deaths`, `assists` |
| Taux de victoire (55 %) | `wins / games` |
| Nombre de parties (53 games) | `games` |
| Gain de LP (− 96 LP) | `MatchSummary.lpDelta`, sommé |

`championAggregates()` dans `src/domain/metrics.ts` fait déjà la moitié du travail :
il agrège `games`, `wins`, `kills`, `deaths`, `assists` par champion. Il lui manque la
somme des `lpDelta` et les moyennes par partie — **étends cette fonction plutôt que d'en
écrire une seconde**, et complète `src/domain/metrics.test.ts`.

Tri par nombre de parties décroissant, 7 lignes, puis un bouton
« Voir tous les champions » vers la vue complète du point 2.

---

## 2. Vue complète : un champion par ligne, toute la saison

Le tableau dense d'U.GG. Colonnes, et d'où vient chacune :

| colonne | disponible ? | source |
| --- | --- | --- |
| Rang | oui | index de tri |
| Champion | oui | `champion` |
| Taux de victoire + `32W 24L` | oui | `wins`, `games` |
| KDA + détail k/d/a | oui | déjà agrégé |
| Gain de LP | oui | `lpDelta` sommé |
| Max kills / Max deaths | oui | max sur les parties du champion |
| CS moyen | oui | `cs` |
| Dégâts moyens | oui | `damageToChampions` |
| **Or moyen** | **presque** | `gold_earned` existe dans le DTO backend (`crates/nex-domain/src/api.rs:110`) mais n'est **pas** remonté dans `MatchSummary`. Une ligne à ajouter dans `src/domain/fromMatch.ts` et dans `src/domain/types.ts`. |
| **Doubles / triples / quadras / pentas** | **à dériver** | `largestMultiKill` est déjà lu (cf. `src/domain/badges.ts:130`). Compte, par champion, les parties dont `largestMultiKill` vaut 2, 3, 4, 5. Ce n'est pas le nombre total de multikills de la saison mais le nombre de **parties** où le joueur en a réussi au moins un de ce niveau : écris-le dans l'infobulle, ne laisse pas croire autre chose. |

Filtres en tête de vue, comme U.GG : poste, file (`All Ranked` / Solo / Flex / ARAM),
et saison. Réutilise `RoleFilter` de `src/features/stats/statsShared.tsx`.

### Le coût, qui décide de l'architecture

`/v1/matches/{platform}/by-puuid/{puuid}` borne `count` à **20** et `start` à **1000**
(`backend/src/routes.rs:532`). Une saison complète représente donc jusqu'à **51 appels**
au backend, chacun consommant le quota Riot partagé avec le collecteur.

Conséquence à respecter : **récupère une fois, stocke, puis agrège depuis le stockage.**
Ne relance pas la pagination à chaque ouverture de la page. Un bouton « Mettre à jour »
explicite, comme celui d'U.GG, est préférable à un rafraîchissement automatique qui
mangerait le quota sans que le joueur l'ait demandé.

Affiche la progression pendant la récupération (« 180 parties lues sur 420 »), et garde
la vue utilisable avec ce qui est déjà là.

---

## 3. Bandeau des saisons passées : ce qui est possible, et ce qui ne l'est pas

U.GG affiche `S15 Diamond · S14-3 Emerald · S14-2 Emerald · … · S5 Gold`.

**L'API Riot ne publie pas les rangs des saisons passées.** `league-v4` ne donne que le
rang **courant**. U.GG possède cet historique parce que le site enregistre les rangs de
ses joueurs depuis 2015 : c'est de la donnée accumulée, pas de la donnée lisible.

Ce que NEX a déjà : la table de snapshots derrière `/v1/ranks/{platform}/{puuid}`
(`backend/src/routes.rs:462`), qui rend des `RankSnapshotDto { at, queue, tier, division,
lp, wins, losses }`. Elle se remplit **à partir du moment où NEX a vu le compte pour la
première fois**. Il n'y a ni champ `season`, ni rien avant cette date.

Donc, deux options honnêtes — et une interdite :

- **À faire** : affiche les saisons que NEX a réellement observées, en découpant
  l'historique de snapshots aux dates de début de saison, et dis-le clairement
  (« depuis que NEX suit ce compte »). Au début il n'y aura qu'une seule pastille, et
  c'est normal.
- **Acceptable** : n'affiche le bandeau que lorsqu'au moins deux saisons sont observées,
  pour éviter une rangée à un seul élément qui ressemble à un bug.
- **Interdit** : déduire un rang passé du niveau actuel, des points de maîtrise, ou de
  quoi que ce soit d'approchant. Un rang inventé est pire qu'un rang absent.

Ajoute un champ saison aux snapshots, ou déduis-le des dates de début de saison tenues
dans une table du code — mais alors commente d'où viennent ces dates.

---

## Contraintes du projet, rappelées

- Aucune statistique simulée, jamais, y compris en développement.
- La clé Riot reste dans `backend/.env`.
- Rien n'est importé d'U.GG, d'OP.GG ou d'un autre site : la mise en page peut s'en
  inspirer, les chiffres viennent des parties lues via l'API Riot ou du backend NEX.
- Interface en français.
- Les champs déjà normalisés ne sont pas recalculés ailleurs.

## Critères d'acceptation

1. La carte du profil montre 7 champions avec KDA, taux de victoire, parties et LP.
2. La vue complète liste tous les champions joués, triable sur chaque colonne.
3. L'or et les multikills sont lus depuis les parties, pas approximés.
4. La récupération d'une saison ne relance pas 51 appels à chaque affichage.
5. Le bandeau des saisons ne montre que des rangs réellement observés, et le dit.
6. `npm run check` passe, nouveaux tests compris.
7. Captures du résultat, et la liste de ce qui a été laissé de côté.
