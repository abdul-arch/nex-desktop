# Prompt — overlay de l'écran de chargement : les 10 joueurs

## Ce que montre la vidéo

Pendant l'écran de chargement, un panneau se pose par-dessus et affiche **une carte par
joueur**, dix au total, alignées sur les dix emplacements du chargement. Relevé image par
image (horodatages 1 s à 6 s du clip) :

**Barre du haut**

- À gauche : `[ALT+X] TO TOGGLE` — le raccourci qui montre et masque le panneau.
- Au centre : la file et un compte à rebours, `Solo/Duo 0:13`, qui monte jusqu'à `0:21`.
  C'est le temps écoulé depuis le début du chargement.
- À droite : `Reveal All` et une croix de fermeture.
- Au-dessus : `LAST MATCH · Victory · 2/2/9` — le résultat de la partie précédente.

**Carte d'un joueur** (de haut en bas)

| Zone | Contenu relevé |
| --- | --- |
| Coin haut gauche | Nom du champion, en gris : `Darius`, `Diana`, `Hwei`, `Smolder` |
| Coin haut droit | Une série en cours : `3 ❄` (3 défaites), `2 🔥` (2 victoires) |
| Sous le titre | `351 games – 55.6% WR`, `46 games – 87.0% WR`, `1 games – 0.0% WR` |
| Centre | L'illustration de chargement du champion |
| Bas de l'illustration | Une rangée d'icônes : 2 sorts d'invocateur, un séparateur, la rune clé et la voie secondaire |
| Sous l'illustration | Le pseudo, en blanc et en gras : `MurdKaiser`, `Chall but virgin`, `five fingers` |
| Dernière ligne | Emblème de rang + `117 LP` + `52.9% (245W-218L)` |

**Panneau de survol.** En passant sur une carte, un panneau s'ouvre : onglets
`24 Hours` / `30 Days`, un en-tête `6 GAMES – 3 WINS`, la moyenne `5.0 / 5.3 / 8.7`, puis
les dernières parties, une ligne chacune : icône du champion, KDA (`4/2/2`, `2/2/9`,
`7/8/15`, `6/5/10`, `1/3/2`) et la file.

## Ce que NEX peut alimenter, et à quel prix

C'est le cœur du sujet. Trois des colonnes sont faciles, une ne l'est pas du tout.

### 1. La liste des dix joueurs — gratuit

Le client local la donne. NEX lit déjà le LCU (`src-tauri/src/adapters/lcu.rs`) et connaît
l'étape `loading` (`stage_of` dans `src-tauri/src/client/model.rs` traduit déjà la phase
`InProgress`). Il manque un seul point de lecture : `/lol-gameflow/v1/session`, dont
`gameData.teamOne` et `teamTwo` donnent, pour chacun, le `puuid`, le `summonerId`, le
`championId` et les sorts d'invocateur. Aucun appel à Riot, aucune limite de débit.

C'est la première chose à faire : sans la liste, rien d'autre n'a de sens.

### 2. Rang, LP, victoires et défaites — 10 appels

`league-v4/entries/by-puuid/{puuid}`, un par joueur. À 20 requêtes/seconde, c'est une
demi-seconde de budget. Ça donne le tier, la division, les LP, les `wins`/`losses` de la
saison — donc `117 LP` et `52.9% (245W-218L)`.

Ça donne aussi `hotStreak`, **mais seulement un booléen** : « en série » ou non. Le
`3 ❄` / `2 🔥` de la vidéo, avec le nombre, demande l'historique (voir plus bas).

### 3. L'expérience sur le champion joué — pas comme dans la vidéo

`351 games – 55.6% WR` sur *ce champion* n'est accessible par aucun point d'entrée de
l'API Riot. DPM l'a parce qu'il stocke l'historique de tout le monde. NEX a 4 700 parties
collectées : la probabilité qu'il connaisse l'historique de ces dix joueurs est nulle.

**Ne pas inventer ce chiffre, ne pas l'approcher par autre chose en gardant le même
libellé.** Deux remplacements honnêtes, au choix :

- **La maîtrise du champion** : `champion-mastery-v4/by-puuid/{puuid}/by-champion/{id}`,
  10 appels, donne les points et le niveau de maîtrise. Ce n'est pas un nombre de parties,
  et l'affichage doit dire « maîtrise », pas « parties ».
- **Les N dernières parties** : `match-v5` par joueur. Une liste d'identifiants par joueur
  (10 appels) puis chaque partie (jusqu'à 5 × 10 = 50 appels, moins les parties communes).
  Ça donne la forme récente, le compte de la série, et de quoi remplir le panneau de
  survol. **Mais ça consomme le même budget que le collecteur**, qui prend déjà des 429 en
  continu : il faut le mettre en pause pendant la lecture, ou accepter qu'il ralentisse.

Commencer par la maîtrise, qui tient en 10 appels. Les dernières parties viennent après,
derrière un réglage, une fois le reste en place.

## La construction

### Déclenchement et cycle de vie

Le panneau s'ouvre quand l'étape passe à `loading` et se ferme quand la partie commence
(`in_game`) — l'overlay en jeu prend alors le relais. Un raccourci global le montre et le
masque, comme `ALT+X` dans la vidéo ; choisir une combinaison libre et **vérifier qu'elle
s'enregistre**, en reprenant le mécanisme de `FAILED_SHORTCUTS` déjà en place : un
raccourci pris par une autre application avait déjà fait passer une fonction pour cassée.

Le chargement dure de 15 à 60 secondes. Les appels doivent donc partir **dès** l'étape
`loading`, en parallèle, et chaque carte s'enrichir à mesure que sa réponse arrive — pas
d'écran vide pendant dix secondes puis tout d'un coup.

### Disposition

Dix cartes, deux rangées de cinq, alignées sur les emplacements du chargement, équipe
alliée en haut. Les cartes reprennent le style des widgets d'overlay (`.ov-widget-box`) :
fond sombre translucide, intitulé discret, chiffres tabulaires.

### Ce qui manque reste visible

La règle habituelle de NEX s'applique, et elle compte double ici : une carte dont le rang
n'a pas pu être lu affiche « rang indisponible », pas un rang par défaut. Un joueur non
classé affiche « non classé », pas `0 LP`.

## Le plein écran exclusif, encore

L'écran de chargement est rendu par le jeu. Une fenêtre ne peut pas passer au-dessus d'un
plein écran exclusif : le panneau sera invisible, exactement comme l'overlay en jeu. Le
rappel « mode fenêtré sans bordure » doit être répété sur cette page de réglages, pas
seulement sur celle des overlays.

## Les pièges

- **Ne pas écrire dans le client.** Lecture seule du LCU, comme aujourd'hui.
- **Ne pas déclencher les 10 appels à chaque sondage** du gameflow : une fois par partie,
  mis en cache sur l'identifiant de partie.
- **Ne pas bloquer le collecteur sans le dire** : s'il faut le mettre en pause pour tenir
  le budget, l'afficher dans l'interface.
- **Les pseudos sont des données personnelles d'autres joueurs** : ils restent à l'écran,
  ils ne partent nulle part et ne sont pas enregistrés.

## Vérification attendue

- `npm run check` au vert.
- Les dix cartes rendues à partir d'un instantané de `/lol-gameflow/v1/session` enregistré,
  rejouable hors partie — sans quoi il faudrait relancer une partie à chaque essai.
- Une carte dont l'appel `league-v4` échoue : « rang indisponible », pas de valeur inventée.
- Le compte des appels par partie, mesuré et affiché dans les journaux.
- Une capture du panneau par-dessus un écran de chargement réel.
