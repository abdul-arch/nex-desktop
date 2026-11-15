# NEX web : une version publique, recherche de joueur et builds conseillés

Objectif : un site public où n'importe qui cherche un joueur, consulte son profil et son
historique, et lit les tier lists et builds observés par NEX.

Ce document a été écrit **après avoir mesuré ce que le dépôt contient déjà**. La bonne
nouvelle d'abord : il ne s'agit pas de réécrire NEX. L'essentiel existe.

---

## 1. Ce qui est déjà fait, et qu'il ne faut pas refaire

`src/platform/` sépare l'interface de ses deux implémentations depuis le début :

```ts
// src/platform/index.ts
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const platform = isTauri ? createDesktopPlatform() : createWebPlatform();
```

**`src/platform/web.ts` fait déjà 394 lignes et couvre les 81 fonctions du contrat.** Il
parle au backend en HTTP là où la version bureau passe par l'IPC Rust. Toutes les pages
de statistiques, de profil et de classement fonctionnent déjà à travers lui : c'est cet
adaptateur qu'un navigateur utilise aujourd'hui en développement.

Le backend expose déjà tout ce dont un site public a besoin :

```
/v1/players/{platform}/{game_name}/{tag_line}     recherche d'un joueur
/v1/names                                          autocomplétion des pseudos
/v1/matches/{platform}/by-puuid/{puuid}            historique
/v1/match/{platform}/{match_id}[/timeline]         détail d'une partie
/v1/ranks/{platform}/{puuid}                       historique de rang
/v1/stats/tierlist                                 tier list filtrable
/v1/stats/champion/{id}/build                      BUILD CONSEILLÉ
/v1/stats/champion/{id}/matchups                   matchups
/v1/leaderboard/{platform}                         classements
/v1/stats/meta · /v1/stats/baselines · /v1/stats/winprob
```

**Ne crée donc ni nouvel adaptateur, ni nouvelle API.** Le travail porte sur quatre
verrous, et sur ce qu'il faut cacher.

---

## 2. Le verrou numéro un : une seule ligne

```ts
// src/platform/web.ts:70
const API_BASE = import.meta.env.DEV ? "/nex-api" : null;
```

En production `API_BASE` vaut `null`, et **chaque appel lève « backend NEX injoignable »**.
L'adaptateur web est volontairement limité au développement, où Vite relaie `/nex-api`
vers `127.0.0.1:8787`.

Remplace-le par une base lue à la compilation (`import.meta.env.VITE_API_BASE`), avec
`/nex-api` comme repli en développement pour ne rien casser.

## 3. Le verrou numéro deux : même origine, ou CORS

**Le backend n'a aucune gestion de CORS** — ni `CorsLayer`, ni `tower_http` dans ses
dépendances. Et **il ne sert aucun fichier statique** : pas de `ServeDir`, c'est une API
seule. Deux routes possibles, à trancher avant d'écrire une ligne :

- **Même origine (recommandé)** : le backend sert aussi le `dist/` du front, et l'API vit
  sous `/api`. Aucun CORS, aucun préflight, rien à configurer côté navigateur. Ajoute un
  `ServeDir` avec repli sur `index.html` pour que les routes du front fonctionnent au
  rechargement.
- **Origines séparées** : ajoute un `CorsLayer` avec une **liste blanche explicite** de
  domaines. Jamais `Any` : l'API est publique en lecture, mais rien n'oblige à laisser
  n'importe quel site l'utiliser comme backend gratuit.

## 4. Le verrou numéro trois, et le vrai : la clé Riot

C'est le point qui décide si ce projet existe ou non.

La clé actuelle est une **clé personnelle : 100 requêtes par 2 minutes**. Mesuré
aujourd'hui sur ce dépôt : lire l'historique complet d'**un seul** joueur (562 parties) a
saturé ce quota pendant une vingtaine de minutes, et le collecteur, qui partage le même
budget, tombait à zéro partie ingérée sur 25 secondes d'observation.

Un site public, c'est cette même clé pour tous les visiteurs à la fois.

Donc :

1. **Demande une clé de production à Riot.** Elle s'obtient en enregistrant le produit sur
   le portail développeur, avec une description, une URL et une démonstration. Riot
   l'examine. Sans elle, le site tombera au premier visiteur simultané.
2. **Mets en place une file d'attente et un cache agressif côté backend** avant même
   d'ouvrir. Les tier lists et les builds viennent de la base collectée par NEX, pas de
   Riot : ils ne coûtent rien et peuvent être servis à tout le monde. Ce sont les profils
   et historiques qui coûtent.
3. **Sépare les deux budgets.** Le collecteur et les requêtes des visiteurs ne doivent pas
   se concurrencer comme ils l'ont fait aujourd'hui : donne au collecteur une part
   plafonnée, ou fais-le tourner sur une seconde clé.
4. **Respecte les règles Riot** : attribution « NEX isn't endorsed by Riot Games… »,
   pas de monétisation sans accord, pas de données personnelles conservées au-delà du
   nécessaire.

## 5. Ce qu'il faut cacher, et non laisser vide

`web.ts` rend des valeurs neutres pour **19 fonctions** propres au bureau : client League,
overlay, capture, enregistrements, Mayhem lu en local, boutons de fenêtre. Les pages
correspondantes ne planteront pas — elles s'afficheront **vides**, ce qui ressemble à une
panne.

Masque donc ces entrées de navigation en web plutôt que de les montrer inertes :

| page | sort en web | pourquoi |
| --- | --- | --- |
| Partie en direct | masquée | lit le client League local |
| Overlays | masquée | fenêtre native |
| Enregistrements | masquée | capture d'écran locale |
| ARAM Mayhem | **partielle** | le jeu de données vient du backend, la lecture du client non |
| Spectate | **partielle** | la liste vient de Riot, le lancement du spectateur est local |
| Collection | **partielle** | les skins viennent de CDragon, l'inventaire du client non |

Ajoute un drapeau au contrat (`platform.estWeb`, ou un champ de capacités) plutôt que de
tester `isTauri` dans les composants : le choix d'adaptateur doit rester au même endroit.

## 6. Ce que le site doit faire, lui

- **Recherche de joueur** : champ unique « Pseudo#TAG », sélection de région, avec
  l'autocomplétion de `/v1/names`. C'est la porte d'entrée, elle doit être sur l'accueil.
- **Page profil publique** : rang, historique, statistiques par champion. Elle existe déjà.
- **URL partageables** : `/joueur/euw1/Katsuki%20Sama-EUW` doit s'ouvrir directement. La
  navigation actuelle est en mémoire (`src/app/navigation.tsx`) ; il faut la refléter dans
  l'URL, sinon aucun lien n'est partageable et le rechargement perd la page.
- **Builds conseillés** : `/v1/stats/champion/{id}/build` sert déjà objets, runes et ordre
  de compétences observés. Mets-les en avant : c'est la raison pour laquelle on vient.
- **Métadonnées de partage** et rendu lisible sans JavaScript pour les robots, si le
  référencement compte.

## 7. Contraintes du projet, rappelées

- Aucune statistique simulée, jamais.
- La clé Riot reste **côté serveur uniquement**. Un site public rend cette règle critique :
  elle ne doit jamais atteindre le bundle du front.
- Rien n'est importé d'U.GG, d'OP.GG ou de Blitz.
- Interface en français.
- Les chiffres affichés sortent de l'API Riot ou de la base collectée par NEX, et la page
  dit laquelle.

## Critères d'acceptation

1. `npm run build` produit un site qui parle au backend sans Vite.
2. La recherche d'un joueur fonctionne depuis une machine qui n'a ni NEX ni League.
3. Les pages propres au bureau sont absentes de la navigation, pas vides.
4. Une URL de profil se partage et se recharge.
5. La clé Riot n'apparaît nulle part dans `dist/`.
6. Le quota est protégé : un visiteur ne peut pas déclencher la lecture de mille parties.
7. `npm run check` passe.
