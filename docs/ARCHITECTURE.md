# Architecture NEX

Application desktop League of Legends pour Windows. Tauri 2 (Rust) pour le noyau natif, React + TypeScript + Vite pour l'interface compilée en fichiers statiques. Le produit installé n'exécute ni serveur Node, ni SSR, ni base serveur.

## Audit de départ (7 novembre 2026)

- Dépôt : gabarit `create-tauri-app` (React + TS) fraîchement généré. Pas de NEX_WEB, pas de modifications locales à préserver. Git n'est pas installé sur la machine : le projet n'est pas encore versionné.
- Environnement vérifié : Node 22.20, Rust 1.99, MSVC Build Tools 2022, WebView2 157.
- Références : les six captures (DPM : dashboard, draft/build, overlays, enregistrements, collection ; Invade : matchups) ont été lues. Seuls les cadres d'application servent de référence ; les éléments marketing autour sont ignorés. Les valeurs des captures sont illustratives et ne sont reprises nulle part.

## Vue d'ensemble (étape 2)

```
[Interface React] --IPC typé--> [Noyau Rust desktop] --HTTP--> [Backend NEX] --clé Riot--> [API Riot]
        |                              |                            |
   adaptateur web (dev :          SQLite local :             SQLite : cache normalisé,
   proxy Vite /nex-api)           préférences, favoris,      limites de débit, dédup.
                                  cache timelines/catalogue
```

Le crate `crates/nex-domain` est partagé par l'app et le backend : Riot ID, plateformes et routage, contrats JSON `/v1`.

## Couches

```
src/                       Interface (React)
  app/                     État global, navigation (historique précédent/suivant), routes
  shell/                   Sidebar, barre supérieure, palette Ctrl+K
  features/<module>/       Écrans (dashboard, profil, paramètres, modules à venir)
  ui/                      Composants réutilisables, sans dépendance Tauri (partageables avec un site)
  domain/                  Calculs purs et testés : métriques, score NEX, Riot ID
  data/                    URLs Data Dragon, jeu de démonstration isolé
  platform/                Contrats typés + adaptateurs distincts desktop (IPC) / web
src-tauri/src/             Noyau natif (Rust)
  domain/                  Règles pures : Riot ID, plateformes et routage régional
  persistence/             SQLite : migrations, préférences, favoris, recherches, cache HTTP
  adapters/                Sources externes : Data Dragon (fait) ; backend NEX, LCU, Live Client (à venir)
  commands.rs              Commandes IPC (validation + vérification de la fenêtre appelante)
  error.rs                 Erreurs normalisées { code, message }
```

Règle : les composants n'importent jamais `@tauri-apps/*`. Ils passent par `platform` (`src/platform/index.ts`), qui choisit l'adaptateur desktop ou web au démarrage.

## Contrats IPC

| Commande | Paramètres | Retour | Validation Rust |
| --- | --- | --- | --- |
| `app_info` | – | `AppInfo` | fenêtre `main` |
| `settings_get` | – | `Settings` | fenêtre `main` |
| `settings_set` | `key`, `value` | `Settings` | liste fermée de clés, valeur typée par clé |
| `favorites_list` / `favorites_add` / `favorites_remove` | `riotId`, `platform` / `id` | `SavedPlayer[]` | Riot ID 3–16 + tag 3–5, plateforme connue, 100 max |
| `recent_searches_list` / `recent_search_push` / `recent_searches_clear` | idem | `SavedPlayer[]` | idem, 20 max (rotation) |
| `static_data_version` | – | `StaticDataVersion` | version `\d+.\d+.\d+` uniquement |
| `static_catalog` | – | `Catalog` (champions, objets, sorts, runes) | langue en liste blanche, chemins d'icônes filtrés |
| `open_external` | `url` | – | HTTPS, hôte en liste blanche, ni port ni identifiants |
| `backend_health` | – | `BackendStatus` | fenêtre `main` |
| `player_profile` | `riotId`, `platform`, `refresh?` | `PlayerProfileDto` | Riot ID + plateforme |
| `player_matches` | `platform`, `puuid`, `start?`, `count?`, `queue?`, `timelines?` | `MatchPageDto` | PUUID, pagination ≤ 1000, count ≤ 20, timelines ≤ 10 |
| `match_get` / `match_timeline` | `platform`, `matchId` | `MatchDto` / `TimelineDto` | identifiant de match |

Réglages ajoutés à l'étape 2 : `backendUrl` (HTTPS, ou HTTP uniquement en boucle locale ; ni identifiants ni paramètres), puis `linkedRiotId` et `linkedPlatform` (le compte qui alimente le dashboard).

Erreurs : `invalid_input`, `not_found`, `forbidden`, `network`, `rate_limited`, `storage`, `unavailable`.

## Sécurité en place (revue de l'étape 7, 8 novembre 2026)

**Fenêtres et IPC**
- **Deux capacités**, une par fenêtre :
  - `main-window.json` : 49 commandes applicatives et les contrôles de fenêtre utiles ;
  - `overlay-window.json` : 9 commandes de lecture (réglages, catalogue, builds, instantané de partie) et la disposition de ses widgets ; aucun import, aucun accès joueur, aucune capture.
  - Aucune permission fichier, shell, HTTP, presse-papiers ou ouverture d'URL côté frontend.
- **Permission par commande** : `build.rs` déclare chaque commande (`AppManifest::commands`), ce qui génère une permission `allow-<commande>`. Une commande absente de la capacité d'une fenêtre est refusée.
- **Défense en profondeur**, vérifiée commande par commande :
  - les 49 commandes contrôlent le libellé de la fenêtre appelante (`require_main` ou `require_main_or_overlay`), et les deux listes concordent avec les capacités ;
  - paramètres validés côté Rust : région, PUUID, Riot ID, file, palier, page, durées, source de capture.
- **CSP de production** : `script-src 'self'`, `connect-src ipc:` (tout le réseau passe par Rust), images limitées à `self`, `data:`, `asset:`, Data Dragon et CommunityDragon, `object-src` / `frame-src` / `base-uri` / `form-action` à `'none'`. `freezePrototype` activé, `withGlobalTauri` désactivé.
  - `style-src 'unsafe-inline'` est conservé : React pose des styles en ligne (largeurs de barres, couleurs). Aucun script en ligne n'est autorisé.
- **Aucun HTML injecté** : ni `dangerouslySetInnerHTML`, ni `eval`, ni `innerHTML` dans l'interface.

**Fichiers et système**
- Protocole d'assets limité au seul dossier `Videos\NEX`, ouvert au démarrage.
- Suppressions envoyées à la Corbeille (`trash`), seulement pour les fichiers situés dans le dossier NEX (`inside_nex`).
- **Liens externes** : uniquement via `open_external`, avec une liste blanche d'hôtes en HTTPS, sans identifiants ni port ; ouverts dans le navigateur système.
- Installateur NSIS en mode utilisateur courant : aucun privilège administrateur.

**Client League (LCU)**
- TLS épinglé sur le certificat racine Riot (`certs/riotgames.pem`), sans désactiver la validation globalement. Un test vérifie qu'un autre hôte est refusé.
- Chemins d'API fixes. Écriture uniquement sur action explicite du joueur : import de runes ou d'objets, spectate.
- Mot de passe du lockfile jamais journalisé.

**Backend local**
- Seul détenteur de la clé Riot (`backend/.env`, ignoré par git). Ni `/v1/health` ni les erreurs ne la renvoient (test dédié). Aucune clé dans les sources.
- Écoute sur 127.0.0.1 par défaut, avec un avertissement si une autre adresse est configurée.
- **Ajouté à l'étape 7** : le backend refuse tout `Host` autre que la boucle locale, ce qui bloque le DNS rebinding. Il refuse aussi les requêtes navigateur intersites (`Sec-Fetch-Site` différent de `same-origin` ou `none`), pour qu'un site web ne puisse pas consommer le quota Riot. Test `rejects_foreign_hosts_and_cross_site`.
  - Avant toute exposition publique, ce filtre devra devenir une liste d'hôtes configurable, avec une authentification client.
- SQL : uniquement des requêtes paramétrées. Les seuls `format!` insèrent des noms de colonnes constants.

**Dépendances**
- `npm audit` : 0 vulnérabilité, dépendances de développement comprises.
- `cargo audit` 0.22.2 (base RustSec du 8 novembre 2026, 1 422 avis, 533 crates) : **0 vulnérabilité**.
  - Cinq avertissements, tous hors du build Windows (vérifié avec `cargo tree --target x86_64-pc-windows-msvc`) :
    - `glib` 0.18.5 (RUSTSEC-2024-0429, « unsound ») et `proc-macro-error` 1.0.4 (RUSTSEC-2024-0370, non maintenu) viennent de la pile GTK de Tauri (`tray-icon`, `muda`) sous Linux ;
    - `zbus_names`, `zvariant` et `zvariant_derive` (RUSTSEC-2026-0370 à 0372, non maintenus) viennent de D-Bus via `tauri-plugin-opener` sous Linux.
  - Ils ne sont donc compilés ni dans `nex.exe` ni dans le backend sous Windows. Ils seront à suivre si une version Linux est un jour publiée.
- Pour relancer les deux audits : `npm run audit`.

## Données

- Fichier SQLite `nex.sqlite3` dans le dossier de données de l'application (`%APPDATA%\gg.nex.desktop`). WAL, cache de pages limité à environ 2 MiB.
- Migrations versionnées par `PRAGMA user_version`. Une base plus récente que l'application est refusée.
- Cache HTTP : TTL par entrée, 2 000 entrées maximum, purge au démarrage, entrée maximale 2 MiB.
- **Mode démo** : données fictives déterministes (`src/data/demo.ts`), activé par défaut tant que le backend n'existe pas. Toujours signalé (« MODE DÉMO », « DONNÉES DÉMO »). Désactivé, l'interface affiche l'état réel des sources et jamais de chiffres de substitution.

## Ordre de livraison

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Audit, Tauri sécurisé, shell, dashboard, première mesure | **fait** |
| 2 | Backend NEX minimal, recherche réelle, profil, historique, détail de match | **fait** (voir ci-dessous) |
| 3 | Champions, builds, matchups (graphique + tableaux), draft manuel | **fait** (imports LCU à l'étape 4) |
| 4 | LCU, imports runes/objets, partie en direct, overlays | **fait** (essayé en spectateur sur une partie réelle) |
| 5 | Capture native mesurée, galerie, lecteur, replay instantané | **fait** (sans audio ; essai en partie à faire) |
| 6 | Collection, spectate, classements, Data Studio | **fait** (spectate limité aux amis par le client League) |
| 7 | Vérification visuelle, sécurité, performances, installateur | **fait** (essais en partie réelle et signature à faire) |

## Étape 2 — ce qui est livré

- **Backend** `backend/` : voir [backend/README.md](../backend/README.md).
- **Recherche** : Riot ID + région → profil réel. Recherches récentes et favoris persistants.
- **Profil** :
  - identité, niveau et date d'actualisation (« Actualiser » force le rafraîchissement) ;
  - rangs Solo/Duo et Flex séparés ;
  - champions et rôles calculés sur l'échantillon chargé, avec la période affichée et la mention explicite que ce n'est pas la saison complète.
- **Historique** (pagination par 10, filtres de file) :
  - résultat, file, date, durée, champion et niveau ;
  - sorts, rune clé et arbre secondaire ;
  - K/D/A, KDA, KP, CS et CS/min, dégâts, vision, GD@15 ;
  - 6 objets + trinket, les 10 participants avec un lien vers leur profil, score NEX.
- **Détail de match** :
  - **Équipes** : tableaux par équipe (rôle, KDA, dégâts, or, CS, vision, balises, objets), objectifs, bannissements, joueur mis en évidence.
  - **Build & runes** : arbres, runes et fragments, ordre d'achat réel (annulations retirées, ventes barrées), grille des compétences A/Z/E/R ou Q/W/E/R.
  - **Timeline** : écart d'or face à l'adversaire direct, CS cumulés comparés, événements clés.
- **Dashboard réel** : compte lié via « C'est mon compte ». Les 20 dernières parties, dont 10 avec timeline pour l'écart d'or @15, alimentent les mêmes métriques que la démo. Les modules non disponibles affichent leur étape au lieu de données fictives.
- **Modes** : Arena et les autres modes hors Faille/ARAM sont exclus des statistiques ; les remakes aussi.

## Étape 3 — ce qui est livré

- **Backend** : collecteur en tâche de fond (`NEX_COLLECTOR=on`) et tables analytiques `a_matches`, `a_participants`, `a_bans` dans le même SQLite. Routes `/v1/stats/meta`, `/tierlist`, `/champion/{id}/build` et `/champion/{id}/matchups`, avec un périmètre validé : patch, file, région, rang, poste.
- **Champions** :
  - grille avec recherche, poste, classe et favoris (réglage `favoriteChampions`, validé en Rust) ;
  - fiche : compétences Data Dragon avec les descriptions converties en texte brut côté Rust, touches A/Z/E/R ou Q/W/E/R, build observé, matchups favorables et difficiles, skins avec aperçu agrandi (splash HD chargé seulement à l'ouverture, navigation clavier, Échap).
- **Builds & tier lists** : tableau triable avec tier, victoires, parties, pick et ban, méthode dépliable et affichage optionnel des petits échantillons.
- **Matchups**, sur le modèle de la capture Invade :
  - sélecteur de champion, de poste et d'adversaire ;
  - bandeau des meilleurs contres ;
  - distribution horizontale des portraits, avec infobulle au survol ou au focus ;
  - compteurs favorable / équilibré / difficile ;
  - tableaux Fort contre et Faible contre triables, avec la colonne « Vous » tirée des parties du compte lié ;
  - page de duel : statistiques, avertissement d'échantillon, tes parties, conseils éditoriaux absents (rien d'inventé), build général du champion.
- **Assistant de sélection** : 5 contre 5 avec bannissements et postes modifiables, « moi », choix argumentés, comparaison des compositions, build du pick. Les boutons d'import de runes et d'objets sont présents mais désactivés, avec l'explication de l'étape 4 (LCU).
- **Visuels officiels** : emblèmes et mini-blasons de rang, icônes de poste et d'objectifs (CommunityDragon, autorisé dans la CSP). Un dessin de repli s'affiche hors ligne.
- **Robustesse** : une limite d'erreur par page évite qu'une erreur d'affichage vide toute l'application.

## Étape 4 — client local, imports, overlays

**Connexion au client League** (`src-tauri/src/adapters/lcu.rs`)
- Découverte : processus `LeagueClientUx.exe` (via `sysinfo`), puis son `lockfile`. Repli sur les dossiers d'installation usuels.
- TLS épinglé sur l'autorité racine de Riot (`src-tauri/certs/riotgames.pem`, téléchargée depuis le site développeur officiel avec ton accord) :
  - `tls_certs_only` : aucune autre racine n'est acceptée ;
  - nom d'hôte vérifié (le certificat couvre 127.0.0.1) ;
  - `https_only` et pas de proxy.
  Vérifié contre le client réel. Le même client HTTP refuse tout autre hôte (test `lcu_probe`, `#[ignore]`).
- Chemins d'API fixes ; seuls des identifiants numériques sont interpolés. Le mot de passe du lockfile n'est jamais journalisé ni envoyé à l'interface.

**Suivi du client** (`src-tauri/src/client/service.rs`), en tâche de fond :

| Étape | Source | Fréquence |
| --- | --- | --- |
| Client absent | recherche du lockfile | 10 s |
| Accueil, salon, file, après-partie | `/lol-gameflow/v1/gameflow-phase` | 4 s |
| Sélection des champions | `/lol-champ-select/v1/session` | 1,5 s |
| Chargement, partie, reconnexion | Live Client Data `127.0.0.1:2999/liveclientdata/allgamedata` | 2 s (chronomètre interpolé dans l'interface) |

Les événements `client://state`, `client://champselect` et `live://snapshot` ne sont émis qu'en cas de changement. En fin de partie, l'instantané est effacé et l'overlay détruit.

**Imports** (`client/imports.rs`), toujours déclenchés par le joueur et vérifiés par relecture :
- **Runes** : une ancienne page « NEX · … » est réutilisée. Si toutes les pages sont prises, le joueur choisit explicitement laquelle remplacer : NEX n'en écrase jamais une d'office.
- **Objets** : l'API remplace la liste entière. NEX relit les sets existants, les conserve à l'identique et ne remplace que son propre set pour ce champion.

**Overlay** (`overlay.rs`, `src/overlay/OverlayApp.tsx`)
- Une seule fenêtre transparente, toujours au premier plan, couvrant l'écran principal. Tous les widgets partagent ce rendu.
- Mode jeu vérifié sur la fenêtre réelle : `WS_EX_TRANSPARENT` (clics transmis au jeu) et `WS_EX_NOACTIVATE` (aucune prise de focus).
- Mode configuration : déplacement par glisser-déposer, positions en fraction de l'écran, échelle, opacité, visibilité et verrouillage enregistrés en SQLite (migration v2).
  - Mode jeu : la fenêtre laisse passer les clics vers le jeu, donc les widgets ne peuvent pas y être déplacés. On les déplace de deux façons :
    - sur l'écran réel, en mode configuration (`Ctrl+Alt+N` ou « Déplacer sur l'écran réel ») ;
    - à tout moment depuis l'**éditeur de disposition** de la page *Overlays* : miniature de l'écran avec les repères du HUD, glisser à la souris ou flèches du clavier (Maj pour un pas de 5 %). L'overlay ouvert se met à jour en direct.
  - Corrigé le 8 novembre 2026 :
    - le relâchement enregistrait parfois une position figée : position lue dans une référence, glisser interrompu géré ;
    - un widget pouvait sortir de l'écran : bornes calculées avec l'échelle ;
    - la barre de configuration recouvrait les minuteurs d'objectifs : elle est déplacée en bas ;
    - les widgets sans donnée étaient vides et impossibles à saisir : ils affichent maintenant un texte d'exemple en configuration.
  - Vérifié dans la fenêtre native (entrées souris simulées) : seul le widget saisi bouge, la position enregistrée correspond au point de dépôt, et le mode jeu revient en sortie.
- Raccourcis globaux : `Ctrl+Alt+N` (configuration) et `Ctrl+Alt+H` (afficher/masquer).
- Compatible avec le jeu en mode **fenêtré sans bordure**. Le plein écran exclusif masque toute fenêtre.
- Capacité dédiée `overlay-window.json` : lecture seule. Aucun import, aucun accès joueur ni backend en dehors des builds.

**Fenêtres et zone de notification** (`windows.rs`)
- La fenêtre principale est créée en code. En mode « zone de notification », la fermer **détruit** sa WebView ; le suivi du client et l'overlay continuent. L'icône permet de rouvrir NEX, d'afficher l'overlay ou de quitter.
- En mode « Quitter », fermer la fenêtre termine tout NEX.
- Drapeaux de diagnostic et de mesure : `--tray` (démarrer sans fenêtre), `--overlay-preview` (overlay en configuration), `--overlay-game` (overlay en mode jeu).

**Interface** : page *Partie en direct* (étapes, sélection en direct, tableau des scores, « Lier ce compte »), page *Overlays* (source, fréquence, calcul et comportement si absent pour chaque widget), assistant de draft synchronisé avec le client, boutons d'import actifs.

**Non vérifié** : affichage des widgets pendant une vraie partie, alt-tab, changement d'écran, échelles d'affichage différentes et imports exécutés. Je n'ai rien écrit dans ton client : les imports sont à déclencher par toi.

## Étape 5 — capture, replay instantané, clips

**Pipeline natif** (`src-tauri/src/capture/`)
- `engine.rs` : Windows.Graphics.Capture, puis encodeur H.264 Media Foundation avec accélération matérielle, en **segments MP4 de 10 s** dans `Vidéos\NEX\.buffer\<session>`.
  - Les images restent des textures GPU ; seule une miniature 320×180 est lue en mémoire, une fois par segment, puis encodée en JPEG (WIC).
  - Cadence : intervalle minimal WGC de 33 ms, et toute image trop rapprochée est **abandonnée**. Aucune file ne grossit côté NEX.
  - Un segment est finalisé hors du fil de capture. Les fichiers `.part` ne sont jamais exposés et sont supprimés en cas d'échec.
- `hw.rs` : refus explicite sans encodeur H.264 matériel (`MFTEnumEx`, `MFT_ENUM_FLAG_HARDWARE`).
- `segments.rs` : tampon de replay borné **à la fois** en durée (120 s par défaut) et en taille (512 Mio par défaut). Le segment le plus récent est toujours conservé.
- `remux.rs` : assemblage de segments sans réencodage. Les paramètres SPS/PPS, la résolution et l'échelle de temps doivent être identiques, sinon refus.
- `service.rs` :
  - démarrage, après vérification de l'encodeur, de 2 Gio libres et du quota (20 Gio par défaut) ;
  - arrêt avec finalisation en arrière-plan ;
  - replay instantané (Ctrl+Alt+R ou bouton), clips automatiques 6 s après un multikill, un ace ou un vol d'objectif du joueur ;
  - partie complète en option ;
  - récupération au démarrage des sessions interrompues, en enregistrements marqués incomplets.
  Les segments copiés dans un clip ou une partie ne dépendent plus du tampon et ne sont donc plus touchés par sa rotation. Le même encodage sert au tampon, aux clips et aux parties complètes : il n'y a jamais de double encodage.

**Modes**
- **Eco**, par défaut : aucune capture, aucun tampon.
- **Capture** : activation explicite dans Enregistrements. La fenêtre « League of Legends (TM) Client » est capturée automatiquement en partie, puis la capture s'arrête et se finalise en fin de partie. Un démarrage manuel sur la fenêtre du jeu, l'écran principal ou une fenêtre choisie reste possible.
- Indicateur « REC » dans la barre supérieure et dans la page.

**Bibliothèque**
- Index SQLite (migration v3) : type, titre, chemin, miniature, champion, mode, KDA, durée, taille, favori, marqueurs, complet.
- Lecture par le protocole d'assets de Tauri, **limité au dossier `Vidéos\NEX`**. Commandes de suppression et d'export vérifiées : chemin canonique dans ce dossier.
- Suppression vers la **Corbeille Windows** (récupérable). « Exporter » ouvre l'Explorateur sur le fichier.
- Marqueurs : les moments de la partie (temps de jeu) sont convertis en temps vidéo, puis affichés sur la barre du lecteur et dans une liste cliquable.

**Interface** : panneau Eco/Capture (statistiques en direct pendant une capture), galerie groupée par jour, recherche, filtres Tous/Clips/Parties complètes, champion, favoris, affichage progressif par 48. Un seul lecteur, ouvert à la demande, sans lecture automatique dans la grille.

**Non fait ou non vérifié**
- Son système et micro.
- Redimensionnement GPU vers 1080p.
- Découpe exacte d'un replay à la seconde (aujourd'hui, arrondi au segment de 10 s).
- Effet sur les FPS du jeu.
- Lecture dans la fenêtre native : le MP4 produit est valide (relu par le lecteur MP4), mais sa lecture dans la WebView n'a pas été observée.

## Étape 6 — collection, classements, spectate, Data Studio

**Collection** (`src/features/collection`, `src-tauri/src/client/collection.rs`, `src-tauri/src/adapters/cdragon.rs`)
- Catalogue : `skins.json` et `skinlines.json` de CommunityDragon (langue de l'interface), mis en cache 7 jours, dernière version servie hors ligne.
  - Skins de base exclus.
  - Les entrées d'autres projets Riot (ids ≥ 1 000 000, personnages « Jade_* ») sont aussi exclues.
  - Seuls les skins dont le champion figure dans Data Dragon sont affichés.
- Possession : inventaire `CHAMPION_SKIN` du client local, en lecture seule, avec la date d'achat.
  - Sans client, le dernier relevé est affiché avec sa date.
  - Sans aucun relevé, l'état est « inconnu », jamais « manquant ».
  - Vérifié sur un client réel : 731 skins possédés, tous datés.
- Valeur : « valeur catalogue estimée » = somme des prix habituels par rareté (Épique 1 350, Légendaire 1 820, Ultime 3 250 RP).
  - Les autres raretés n'ont pas de prix RP direct et sont comptées à part.
  - Ce n'est ni la dépense réelle ni une valeur de revente.
- Disponibilité : seul le statut Legacy (catalogue Riot) est proposé.
  - Le champ `stillObtainable` du client vaut `false` même pour des skins en vente : il n'est pas utilisé.
- Interface :
  - grille virtualisée (seules les rangées visibles sont rendues et chargent leur image) ;
  - filtres possession, champion, série, rareté, Legacy, favoris ;
  - regroupements année d'acquisition, champion, rareté, série ;
  - aperçu plein format avec ←/→, Échap et favori (réglage `favoriteSkins`).

**Classements** : backend `GET /v1/leaderboard/{platform}?queue&tier&page`.
- Source : league-v4 Challenger, Grand Maître ou Maître, en Solo/Duo ou Flex.
- Tri par LP puis victoires, pages de 25 ; cache 30 min.
- Les Riot ID sont résolus via account-v1, en cache 24 h.
- Un nom non résolu (limite de débit) s'affiche « Riot ID indisponible », sans valeur inventée.
- Mesuré : 1,4 s à froid, 13 ms en cache.

**Spectate** : backend `GET /v1/live/{platform}/{puuid}` (spectator-v5, cache 30 s ; 404 = pas en partie).
- Compte lié et favoris : les 8 premiers sont vérifiés automatiquement, les suivants à la demande. Recherche par Riot ID.
- Une partie en cours affiche la file, le chrono et les deux équipes. Vérifié sur une partie réelle (ARAM Mayhem, file 2400).
- « Regarder dans le client » (`src-tauri/src/client/spectate.rs`), **vérifié sur une partie réelle** :
  - POST `/lol-spectator/v1/spectate/launch`, uniquement sur clic, client ouvert dans la même région ;
  - **amis uniquement** : le client exige une `spectatorKey`, et seule celle de la présence des amis (`/lol-chat/v1/friends`, 24 caractères) est acceptée. La clé de l'API Riot (`observers.encryptionKey`, 32 caractères) est refusée par les serveurs Riot (erreur 500), tout comme l'identifiant de partie ;
  - le client attend l'identifiant du chat (UUID de 36 caractères), différent du PUUID de l'API Riot (78 caractères) : NEX fait la correspondance par Riot ID ;
  - le bouton n'est actif que pour un ami en partie observable (`lcu_observable_friends`, actualisé toutes les 30 s) ; sinon une infobulle explique la limite ;
  - lancer directement l'exécutable du jeu est refusé par Windows (« accès refusé », exécutable protégé) : NEX ne le tente pas ;
  - délai mesuré entre le clic et l'ouverture du jeu : 2 min 20 à 2 min 30 (délai spectateur Riot compris).

**Data Studio** (`src/domain/studio.ts`) : analyse les parties réelles du compte lié.
- Chargement : 20 parties, puis par 20 jusqu'à 100.
- Filtres file, poste, champion.
- Courbe par partie (victoire / défaite), moyenne glissante, moyenne de période.
- Mesures : CS/min, dégâts/min, vision/min, KP, part des dégâts, morts/10 min, écart d'or @15.
  - Comparaisons : 10 dernières contre 10 précédentes, victoires contre défaites.
- Objectifs de l'équipe : moyenne en victoire et en défaite, taux de victoire quand l'équipe est devant (affiché à partir de 3 parties).
- Export CSV dans le presse-papiers.
- Mêmes règles que les métriques du dashboard : remakes, parties de moins de 5 min et Arena exclus, ratios de sommes, « — » sans donnée.
- Les écarts victoire/défaite sont présentés comme des associations, pas des causes.

**Non fait ou non vérifié**
- Regarder la partie d'un joueur qui n'est pas un ami : le client League ne le permet pas.
- Augments d'ARAM Mayhem : traité depuis par le crate `nex-mayhem` (catalogue, règles, moteur, lecture locale des cartes, fournisseur de données arammayhem.com). Voir [MAYHEM.md](MAYHEM.md).
- Disponibilité en boutique des skins : pas de source fiable.
- La limite Riot est partagée avec le collecteur : un chargement peut renvoyer « limite atteinte » (message affiché), à relancer quelques secondes plus tard.

## Étape 7 — vérification, sécurité, performances, installateur

- **Sécurité** : revue détaillée dans la section « Sécurité en place ».
  - Ajout d'un filtre `Host` et `Sec-Fetch-Site` sur le backend local.
  - Aucune clé Riot dans `dist/` ni dans les sources.
- **Vérification visuelle** des 13 pages à la taille minimale de la fenêtre (1024×640), dans le navigateur de développement :
  - aucun débordement horizontal ni erreur d'affichage (contrôle automatisé) ;
  - corrigé : la Collection gardait une seule colonne sous 820 px (filtres sur tout le premier écran), le sélecteur de possession était tronqué, et les trois paliers des Classements s'empilaient inutilement.
- **Performances** : mesure 4 dans [PERFORMANCES.md](PERFORMANCES.md), avec un parcours automatique des pages (`--perf-tour`). 134 MiB au repos, pic à 231 MiB, pas de croissance entre deux tours.
- **Installateur** NSIS de 3,2 Mo, en mode utilisateur courant. Installation, lancement et désinstallation vérifiés ; les données utilisateur sont conservées.

### Essais en partie réelle (8 novembre 2026)

Partie classée EUW en cours, ouverte en mode spectateur par NEX (partie d'un ami). Essais automatisables dans `src-tauri/src/client/e2e.rs` (tests ignorés par défaut).

| Élément | Résultat |
| --- | --- |
| Spectate depuis NEX | Accepté par le client, jeu ouvert en 2 min 20 à 2 min 30. Deux essais : `Lcu::spectate`, puis le chemin final (Riot ID → ami → lancement). |
| Détection de la partie | Étapes `champ_select` puis `in_game` détectées ; overlay ouvert automatiquement par-dessus le jeu. |
| Live Client Data | 10 joueurs avec champion, objets et poste ; chrono exact. En spectateur, `activePlayer` n'existe pas : aucune statistique personnelle n'est inventée. |
| Overlay | Corrigé : le widget « NEX » affichait « En attente de partie » en spectateur. Il affiche maintenant le chrono et « Spectateur : pas de statistiques personnelles ». |
| Fin de partie | Après `spectate/quit` : jeu fermé, overlay fermé et instantané effacé automatiquement, client revenu à l'accueil. Tuer le processus du jeu ne suffit pas : le client le relance tant que la phase reste `InProgress`. |
| Capture du jeu | Mesure 5 dans [PERFORMANCES.md](PERFORMANCES.md) : 2560×1440, environ 28 images/s, clip de 20 s et miniature conformes, aucune baisse de FPS visible. |

**Non fait ou non vérifié**
- Signature de code Windows et mises à jour signées : il faut un certificat et une clé, qui ne sont pas fournis. L'installateur non signé déclenche un avertissement SmartScreen. Reporté à plus tard.
- Partie **jouée** (et non regardée) : widgets personnels de l'overlay (compétences, prochain objet, trinket), clips automatiques sur les moments forts, temps de trame sous charge sans limite de FPS.
- Vérification visuelle dans la fenêtre native, et non dans le navigateur de développement ; navigation complète au clavier et lecteur d'écran.

## Historique ARAM Mayhem (9 novembre 2026)

L'API publique de Riot ne fournit pas les parties ARAM Mayhem (file 2400, mode `KIWI`). Vérifié sur un compte réel :
- match-v5 ne les liste pas, avec ou sans filtre de file ;
- demandées par identifiant, elles renvoient 403 ;
- le client League, lui, les a dans son historique.

**Source retenue** : l'historique local du client (`/lol-match-history/v1/...`), en lecture seule.
- Commande `lcu_match_history` (`src-tauri/src/client/history.rs`) : parcourt les 60 dernières parties du client, garde la file 2400, lit le détail de chaque partie (dix joueurs) et le convertit en `MatchDto`.
- Chaque partie terminée est mise en cache 30 jours. Mesuré : 173 ms pour 20 parties, 37 ms ensuite.
- **Limite** : seulement pour le compte connecté au client, client ouvert. Pour un autre joueur, la commande renvoie une liste vide.
- L'identifiant de joueur du client (36 caractères) diffère de celui de l'API Riot : celui du joueur connecté est remplacé par l'identifiant API pour que l'interface le reconnaisse.

**Affichage**
- Profil : filtre « ARAM Mayhem », et fusion dans « Toutes » par date (`mergeLocalMatches`). Tant que Riot a des parties plus anciennes à charger, seules les parties Mayhem plus récentes que la plus ancienne partie Riot affichée sont ajoutées.
- Dashboard : mêmes parties dans la liste récente et le filtre ARAM.
- Détail d'une partie Mayhem : vue des équipes seulement. Riot ne fournit ni timeline ni ordre d'achat pour ce mode, et il n'a pas de runes.
- **Score NEX** : aucune note en ARAM ni en ARAM Mayhem. Les repères provisoires valent pour la Faille (CS/min, vision) ; ils donnaient une note trompeuse.

**Non fait**
- Augments choisis : le client les fournit par partie (`playerAugment1` à `6`), mais ils ne sont pas encore affichés.
- Version web : pas de client local, donc pas de parties Mayhem.

## Classements (10 novembre 2026)

Page `src/features/leaderboards/` sur la composition demandée (onglets, bandeau, filtres de rôle, Top 3, tableau compact).

| Donnée | Source | État |
| --- | --- | --- |
| Rang, LP, victoires, défaites, winrate | Riot league-v4 (Challenger, Grand Maître, Maître), par région et par file | Réel, officiel |
| Riot ID | Riot account-v1, cache 24 h côté backend | Réel |
| Icône d'invocateur | Profil NEX (summoner-v4) | Réel, chargé progressivement |
| Rôle principal et sa part, KDA, champions les plus joués | Riot match-v5, 10 dernières parties de la file | Réel, calculé, affiché comme tel ; rôle annoncé à partir de 5 parties avec un poste connu |
| Spécialistes | Même échantillon : au moins 5 parties sur le champion | Réel, limité à la page affichée |
| Mes listes | `localStorage` (50 comptes), jamais publiées ; tri palier, division, LP (`rankValue`) | Réel |
| Équipes et joueurs professionnels | Leaguepedia (table `Players`, CC BY-SA 3.0), mot de passe robot dans `backend/.env`, collecte `GET /v1/pro/teams` en cache 24 h | Réel : T1, Gen.G, Karmine Corp, G2 Esports, Fnatic ; Los Ratones sans joueur listé |

**Quota Riot** : une clé de développement autorise environ 100 requêtes par 2 minutes. L'analyse des joueurs (`enrich.ts`) est donc séquentielle : les trois premiers tout de suite, puis un joueur toutes les 20 s, une minute de pause après un échec. Les joueurs qui ne sont plus affichés quittent la file d'attente. « Actualiser » retente les échecs.

**Navigation** : filtres et onglet conservés pour la session ; la position de défilement est relevée en quittant la page et rendue au retour (l'application ne remet pas cette page en haut).

**Équipes (Leaguepedia)**
- L'API Cargo refuse les requêtes anonymes (`ratelimited`). Le backend (`backend/src/pro.rs`) se connecte avec un mot de passe robot, en lecture seule. `LEAGUEPEDIA_USER` et `LEAGUEPEDIA_PASSWORD` se trouvent dans `backend/.env` ; ils ne sont jamais journalisés ni renvoyés.
- Équipes suivies : liste `TEAMS` dans `pro.rs`. Ne sont retenus que les joueurs actifs aux cinq postes.
- `SoloqueueIds` est du texte saisi par des bénévoles. Seuls sont gardés les Riot ID complets (`Pseudo#TAG`) rattachés à une région connue ; les anciens pseudos sans tag sont comptés comme ignorés.
- Mesuré le 10 novembre 2026 : 67 comptes exploitables pour 5 équipes, en 1,1 s.
- **Affiliation sur le classement d'une région** : le Riot ID exact renvoyé par Riot pour ce compte doit figurer parmi les comptes déclarés du joueur, dans la même région. La bascule « Tous / Pro » filtre sur cette correspondance.
- **Classement d'une équipe** : chaque compte déclaré est lu chez Riot, un à la fois. Riot ID introuvable, non classé dans la file ou erreur : chaque cas est affiché tel quel. Une même personne avec plusieurs comptes apparaît comme « Joueur · compte n/N ». Le tri se fait par palier, division puis LP, toutes régions confondues, avec la mention « Classement des comptes suivis ».

## Raccordements restants

- **Variation de LP** : match-v5 ne la fournit pas. Elle demandera des relevés league-v4 enregistrés à intervalles réguliers.
- **Coffre système** (Windows Credential Manager) : à ajouter quand un secret de session devra persister. Il n'y en a aucun à ce stade.
- **Mises à jour signées** (plugin updater) et **signature Windows** : à configurer avec une clé et un certificat réels, qui ne sont pas fournis.
