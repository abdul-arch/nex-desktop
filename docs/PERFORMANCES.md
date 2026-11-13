# Rapport de performances NEX

## Machine de référence

| | |
| --- | --- |
| OS | Windows 11 Professionnel 10.0.26300 |
| CPU | AMD Ryzen 7 7700 (8 cœurs, 16 logiques) |
| RAM | 31,1 Go |
| GPU | NVIDIA GeForce RTX 4070 SUPER (+ AMD Radeon intégré) |
| WebView2 | 157.0.4341.42 |
| Écran | 2560×1440 |

## Méthode

`scripts/measure-memory.ps1` (ou `npm run measure`) mesure `nex.exe` **et tous ses descendants**, dont les processus WebView2 (navigateur, rendu, GPU, utilitaires). Le script additionne uniquement la mémoire privée, pour ne pas compter deux fois la mémoire partagée :

- **Private Working Set** : mémoire privée résidente (compteur `Working Set - Private`) ;
- **Private Bytes** : mémoire privée engagée ;
- **CPU** : `% Processor Time` divisé par le nombre de cœurs logiques, donc en pourcentage de la capacité totale.

Aucune purge artificielle du working set.

## Mesure 1 — étape 1, build release

- Exécutable : `src-tauri/target/release/nex.exe` (6,9 Mo, LTO, `opt-level=3`).
- État : fenêtre principale 1440×900 sur le Dashboard en mode démo, 1 bandeau splash et environ 10 illustrations Data Dragon chargées. Mesure lancée 20 s après le démarrage, puis 12 échantillons à 5 s d'intervalle (1 minute).
- CSV brut : `docs/perf/etape1-dashboard.csv` (exclu du dépôt).

| Processus | Private WS (MiB) | Private Bytes (MiB) |
| --- | ---: | ---: |
| nex.exe (Rust) | 4,5 | 6,0 |
| WebView2 navigateur | 25,6 | 34,4 |
| WebView2 GPU | 48,2 | 182,7 |
| WebView2 rendu | 30,9 | 40,8 |
| WebView2 utilitaires (3) | 11,3 | 22,3 |
| **Total (7 processus)** | **120,5** | **286,2** |

Sur 12 échantillons : Private WS moyen **123,4 MiB** (min 120,5, max 126,3) ; CPU moyen **0,05 %** (max 0,31 %).

### Comparaison aux cibles

| État | Cible | Mesuré | Verdict |
| --- | --- | --- | --- |
| Interface ouverte et stabilisée | < 250 MiB Private WS | 123 MiB | dans la cible |
| CPU au repos (interface affichée) | < 1 % | 0,05 % | dans la cible |
| Veille, WebViews déchargées | < 120 MiB | – | non mesurable : pas encore de mode zone de notification (étape 4) |
| Overlay seul | < 200 MiB | – | non mesurable : overlay à l'étape 4 |

Le processus GPU de WebView2 engage la plus grosse part des Private Bytes (183 MiB engagés, 48 MiB résidents). Il faudra le suivre quand la galerie de clips et les grandes illustrations arriveront.

## Mesure 2 — étape 4, build release (7,9 Mo)

Même machine et même méthode. Chaque scénario : démarrage, 20 s de stabilisation, puis 6 échantillons à 5 s d'intervalle. Client League ouvert sur l'accueil, aucune partie en cours (overlay en mode jeu, widgets « en attente »). CSV : `docs/perf/etape4-*.csv`.

| Scénario | Lancement | Processus | Private WS moyen (MiB) | Private Bytes (MiB) | CPU moyen | Cible | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| A. Interface ouverte (Dashboard) | `nex.exe` | 7 | 130,2 | 301 | 0,00 % | < 250 MiB | dans la cible |
| B. Veille, zone de notification, aucune WebView | `nex.exe --tray` | 1 | 4,8 | 6 | 0,00 % | < 120 MiB | dans la cible |
| C. Overlay seul, fenêtre principale non chargée | `nex.exe --tray --overlay-game` | 7 | 88,4 | 205 | 0,00 % | < 200 MiB | dans la cible |
| D. Interface et overlay ouverts | `nex.exe --overlay-game` | 8 | 158,1 | 411 | 0,00 % | – | mesuré |

Le suivi du client tourne dans tous les scénarios, avec une requête locale toutes les 4 s, sans effet mesurable sur le CPU. En mode zone de notification, la fenêtre principale est réellement détruite : il ne reste qu'un processus Rust de 4,8 MiB.

## Mesure 3 — étape 5, capture vidéo (build release)

**Chaîne évaluée.**
- Windows.Graphics.Capture via le crate `windows-capture` 2.0.1, avec les images en textures GPU.
- Encodage par Media Foundation (`MediaTranscoder`, accélération matérielle demandée). Encodeurs H.264 matériels détectés par `MFTEnumEx` : **NVIDIA H.264 Encoder MFT** et **AMDh264Encoder**. Sans encodeur matériel, NEX refuse de démarrer ; il ne bascule jamais sur le « H264 Encoder MFT » logiciel.
- Segments MP4 de 10 s ; replays et parties complètes assemblés **sans réencodage** (crate `mp4`).

**Protocole.** Fenêtre de test animée (1280×720, contenu changeant à 60 Hz, `scripts/capture-test-window.ps1`) capturée par `nex.exe "--capture-selftest=NEX capture test"` : 20 s de capture, replay de 15 s, arrêt, puis suppression automatique des fichiers de test. Mesure de tous les processus NEX par `scripts/measure-memory.ps1`. CSV : `docs/perf/etape5-*.csv`.

| Mesure | Résultat |
| --- | --- |
| Profil effectivement mesuré | H.264, résolution native de la fenêtre (1282×752), 30 i/s, ~5 Mbit/s cible pour cette taille |
| Images capturées en 20 s | 568 à 576 (≈ 28,5 i/s), 0 à 2 abandonnées par la politique de cadence |
| Mémoire privée NEX pendant la capture | 194 MiB en moyenne (max 201), contre 134 MiB sans capture, soit **+60 MiB** (cible < 200 MiB) |
| CPU pendant la capture | 2,9 % en moyenne, 6,5 % au maximum (rotation de segment), sur 16 cœurs logiques |
| Après l'arrêt | 134 MiB et 0 % : ressources libérées, aucune croissance |
| Replay 15 s demandé | 20 s fournies (découpage au segment de 10 s), MP4 de 4,1 Mo, miniature générée |

**Limites.**
- `windows-capture` recadre sans redimensionner : la capture se fait à la **résolution de la fenêtre du jeu**. Le profil « 1080p30 depuis une source 1440p » demande un redimensionnement GPU qui n'est pas implémenté. Avec un jeu en 2560×1440, le profil réel sera **1440p30** (~20 Mbit/s) et devra être mesuré en partie.
- L'effet sur les FPS et le temps de trame du jeu n'a pas été mesuré : la mesure ci-dessus porte sur une fenêtre de test, pas sur League en cours.
- Pas d'audio : la capture du son système (WASAPI en boucle) n'est pas encore branchée, et le micro est désactivé.

## Mesure 4 — étape 7, application complète (build release)

Exécutable 8,7 Mo, installateur NSIS 3,2 Mo. Même machine, même méthode. Client League ouvert sur l'accueil, backend local et collecteur actifs. CSV : `docs/perf/etape7-*.csv`.

**Parcours automatique.** `nex.exe --perf-tour=6` déclenche le parcours 15 s après le lancement. Il ouvre les 13 pages l'une après l'autre, deux fois, 6 s chacune, en faisant défiler le contenu par six pas d'un écran. Cela fait défiler les galeries Collection (1 964 skins), Champions et l'historique. Le parcours est en lecture seule : aucun import, aucune écriture.

| Scénario | Échantillons | Private WS moyen | Min / max | CPU moyen | Cible | Verdict |
| --- | ---: | ---: | --- | ---: | --- | --- |
| A. Dashboard stabilisé (compte lié, données réelles) | 6 × 5 s | 133,7 MiB | 130 / 149 | 0,00 % | < 250 MiB | dans la cible |
| B. Parcours des 13 pages, 2 tours | 36 × 5 s | 179,7 MiB | 137 / **231** | 0,02 % | < 250 MiB | dans la cible |
| C. Retour au Dashboard après le parcours | 6 × 5 s | 170,0 MiB | 165 / 178 | 0,00 % | < 250 MiB | dans la cible |

**Lecture.**
- Le pic du second tour est **plus bas** que celui du premier (218 contre 231 MiB) : aucune croissance d'un tour à l'autre, donc pas de fuite détectée sur ce parcours.
- Après le parcours, la mémoire se stabilise environ 36 MiB au-dessus du démarrage. Cela correspond aux caches volontaires : catalogue de skins, catalogue Data Dragon, 60 réponses en mémoire au plus, images décodées par WebView2.
- La valeur CPU échantillonnée toutes les 5 s sous-estime les pics brefs de rendu pendant les changements de page.

**Installateur** (`npx tauri build`) :
- installation silencieuse (`/S`) en 1,5 s, sans privilège administrateur ;
- entrée « NEX 0.1.0, éditeur NEX » dans les programmes de l'utilisateur et raccourci dans le menu Démarrer ;
- l'application installée démarre et ouvre sa fenêtre avec WebView2 ;
- désinstallation silencieuse : dossier, entrée et raccourci retirés, données utilisateur (`%APPDATA%\gg.nex.desktop`) conservées.

## Mesure 5 — capture d'une vraie partie de League (spectateur)

Partie classée EUW en mode spectateur, jeu en 2560×1440 avec FPS limités à 180. L'auto-test `--capture-selftest="League of Legends (TM) Client"` (build de développement) capture 20 s puis enregistre un clip de 15 s, supprimé ensuite. Charge du jeu lue par les compteurs Windows (`Win32_PerfFormattedData_*`, indépendants de la langue).

| Mesure | Sans capture | Pendant la capture | Après |
| --- | ---: | ---: | ---: |
| CPU du jeu (capacité totale) | 10,4 % | 8,0 % | 6,4 % |
| GPU 3D du jeu | 36,1 % | 25,2 % | 24,4 % |
| Encodeur vidéo matériel | 0 % | 4,6 % | 0 % |
| FPS affichés par le jeu (6 relevés) | 180 (plafond) | 180 (plafond) | – |

- Images : 564 et 567 en 20 s sur deux essais (≈ 28 i/s pour 30 visées), 13 à 14 abandonnées, résolution native 2560×1440.
- Clip de 20 s : 49,9 Mo (≈ 20 Mbit/s en 1440p). La miniature montre bien l'image du jeu ; l'overlay NEX n'apparaît pas dans l'enregistrement.
- La charge du jeu dépend surtout de la caméra du spectateur : la baisse pendant et après la capture n'est pas un effet de NEX. Conclusion prudente : aucune hausse de charge ni baisse de FPS observée, au plafond de 180 i/s.
- Non mesuré : temps de trame sans limite de FPS (outil type PresentMon non installé) et capture pendant une partie jouée.

## Non mesuré à ce stade

- Session de 30 minutes : le parcours automatique couvre environ 3 minutes (2 tours des 13 pages).
- Temps de démarrage à froid.
- Overlay pendant une partie **jouée** : effet sur le temps de trame sans limite de FPS (en spectateur, le jeu reste à son plafond de 180 i/s avec overlay et capture).
- Mesure en 1280×720 et 1920×1080 dans l'application native. L'affichage à ces tailles a été vérifié dans le navigateur de développement, pas leur consommation.
