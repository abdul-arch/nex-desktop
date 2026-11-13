# Demande d'une clé API Riot personnelle — dossier prêt

Préparé le 13 novembre 2026 pour NEX.

---

## 0. À lire d'abord : ce que la clé personnelle change, et ne change pas

| | Clé de développement (actuelle) | Clé **personnelle** | Clé de production |
|---|---|---|---|
| Expiration | **toutes les 24 h** | n'expire pas | n'expire pas |
| Limites | 20 req / 1 s · 100 req / 2 min | **20 req / 1 s · 100 req / 2 min** | 500 req / 10 s · 30 000 req / 10 min |
| Demande | aucune | formulaire, sans vérification | formulaire **+ prototype fonctionnel** |
| Usage public autorisé | non | **non** (ni alpha ni bêta ouverte) | oui |
| Tournament API | non | non | oui |

**Le seul gain réel est l'expiration.** Tu n'auras plus à coller une nouvelle clé chaque
jour — ce qui est précisément le problème qu'on rencontre depuis le début. En revanche les
limites sont **identiques** : le collecteur restera aussi contraint qu'aujourd'hui, et les
429 qu'on voit quand il tourne en même temps que l'app ne disparaîtront pas.

Si l'objectif est de collecter à grande échelle (les médianes du Data Studio, une tier list
comparable à DPM), il faut une clé **de production**, qui exige un produit public et
accessible à un évaluateur Riot. C'est un autre projet : NEX tourne aujourd'hui sur ta
machine, sans site ni distribution.

---

## 1. Ce qu'il te faut avant d'ouvrir le formulaire

1. **Un compte Riot** connecté sur https://developer.riotgames.com.
2. **Une URL publique du produit.** Elle existe maintenant :

   **https://claude.ai/artifact/Hcc2couC5fCozjZsWzNoXD**

   C'est la page produit de NEX (ce qu'il fait, ce qu'il ne fait pas, comment il utilise
   l'API, trois captures, la mention légale). Elle est **privée par défaut** : ouvre-la,
   menu **Partager**, et mets-la en accès public par lien. Vérifie ensuite dans une fenêtre
   de navigation privée qu'elle s'ouvre sans compte — c'est la condition de Riot.

   Le dépôt GitHub reste une meilleure maison à terme (le code en plus de la page), mais il
   demande d'installer `git`, et il n'est pas nécessaire pour envoyer la demande.
   La marche à suivre est dans [PUBLIER-SUR-GITHUB.md](PUBLIER-SUR-GITHUB.md).
3. **La mention légale Riot visible dans le produit.** Déjà en place : elle est dans
   `Paramètres` (« NEX n'est ni approuvé ni sponsorisé par Riot Games… »). Reprends-la aussi
   sur la page publique.
4. Rien d'autre. La clé personnelle ne demande ni société, ni politique de confidentialité,
   ni prototype vérifié.

---

## 2. Le formulaire, champ par champ

Le portail est en anglais. Les réponses ci-dessous sont prêtes à coller ; la traduction
française est dessous à chaque fois, pour que tu saches ce que tu écris.

> Je n'ai pas pu lire le formulaire lui-même (il demande d'être connecté), donc l'intitulé
> exact des champs peut varier d'un ou deux mots. Le contenu, lui, couvre ce que Riot demande :
> le nom, l'URL, le jeu, et une description détaillée.

### Product Name
```
NEX
```

### Product URL
```
https://claude.ai/artifact/Hcc2couC5fCozjZsWzNoXD
```
*(une fois la page passée en partage public — voir le point 1.2)*

### Game
```
League of Legends
```

### Product Group / Type
```
Personal project
```

### Product Description

À coller tel quel :

```
NEX is a desktop companion app for League of Legends that I built for myself, and that I run
only on my own computer. It is not published, not distributed, and not available to other
players.

What it does:
- Shows my own match history and that of players I look up, with per-match detail: scoreboard,
  runes and item order, gold and CS curves from the match timeline.
- Computes descriptive statistics over the matches it has loaded (CS per minute, kill
  participation, damage share, vision per minute, deaths per 10 minutes, gold difference at
  15 minutes) and shows them next to the median of the matches the app has collected itself.
- Records my ranked tier and LP each time it reads a profile, so I can see how my LP moved
  over time. The Riot API only returns the current rank, so this history starts the day the
  app first read it; nothing is reconstructed.
- Shows who I most often play with, from the participants of my own loaded matches.
- Shows public leaderboards (Challenger, Grandmaster, Master) and the accounts of
  professional players that are publicly declared on Leaguepedia.
- Shows in-game overlays built from the Live Client Data API only: a timer, objective respawn
  timers derived from events the game announces to every player, and a reminder of the item
  and skill order most often observed on my champion.

How it uses the API:
- A small local backend holds the API key in a server-side environment file. The key is never
  embedded in the client code and never leaves my machine. All calls go over HTTPS.
- Endpoints used: account-v1, summoner-v4, league-v4, match-v5 (matches and timelines) and
  spectator-v5.
- An application-level rate limiter enforces 20 requests per second and 100 requests per
  2 minutes before any call is made, honours 429 responses and their Retry-After header, and
  backs off instead of retrying immediately.
- Responses are cached in a local SQLite database: matches and timelines are immutable and
  kept, everything else has a short TTL. The app re-reads the cache rather than the API.

It is free, has no ads, no payment of any kind, no betting or gambling feature, no
cryptocurrency, no alternative ranking system, and it never modifies the game or the client.
The Riot legal disclaimer is shown in the app's Settings screen.
```

**Traduction (pour toi, à ne pas coller) :** NEX est une application compagnon pour LoL que tu
as faite pour toi et que tu fais tourner seulement sur ta machine. Elle affiche ton historique
et celui des joueurs cherchés, le détail des parties, des statistiques descriptives, ton
historique de LP relevé par l'app, les joueurs avec qui tu joues le plus, les classements
publics, les comptes de pros déclarés sur Leaguepedia, et des overlays construits uniquement
à partir de la Live Client Data API. La clé vit côté serveur, un limiteur applique les limites
avant chaque appel, et les réponses sont mises en cache en SQLite.

### What problem does it solve? *(si le champ existe)*

```
After a ranked session I want to know what actually changed in my play, not just whether I
won. NEX keeps my own match data in one place, computes the same measure across every game so
the numbers are comparable, and shows each number next to the sample it came from, so I can
tell a real trend from five lucky games. It also records my LP over time, which the API itself
does not provide.
```

---

## 3. Points de vigilance avant d'envoyer

Trois choses dans NEX méritent une relecture au regard des règles Riot. Aucune n'est
rédhibitoire pour une clé personnelle, mais autant les connaître.

**Le « Score NEX ».** Riot interdit les *alternative skill ranking systems, such as MMR or ELO
calculators*. Le Score NEX note une **partie** (0-100, à partir de KDA, KP, CS/min, part des
dégâts, vision), il n'estime pas le niveau d'un joueur ni son MMR. C'est la lecture qui tient,
et c'est aussi ce que font les applications concurrentes. Ne le présente pas comme une
estimation de rang, et la description ci-dessus ne le fait pas.

**La lecture du client League (LCU).** NEX lit l'historique local pour récupérer les parties
ARAM Mayhem, que l'API publique ne sert pas. Le LCU n'est **pas** une API supportée par Riot :
ce n'est pas interdit, ce n'est pas couvert non plus. La description ci-dessus ne le mentionne
pas, ce qui est honnête puisque le formulaire porte sur l'usage de l'API Riot. Si on te pose
la question, dis-le simplement : lecture seule, sur ta propre machine, sans rien écrire dans
le client.

**Les overlays.** Riot interdit tout ce qui donne un avantage déloyal. Les overlays de NEX ne
montrent que ce que la Live Client Data API expose au joueur et ce que le jeu annonce à tout
le monde. C'est le cas d'usage prévu par cette API. Ne va pas au-delà (pas de lecture mémoire,
pas d'information cachée au joueur), et tu restes dans les clous.

---

## 4. Après l'envoi

- La clé personnelle est délivrée **sans vérification humaine** d'après le portail : tu
  devrais l'obtenir rapidement, parfois immédiatement.
- Quand tu l'as : colle-la dans le chat et je l'installe dans `backend/.env` sans l'afficher,
  comme d'habitude. Il faudra aussi **enlever la rotation quotidienne** de ta routine — plus
  besoin de coller une clé chaque jour.
- Si tu veux ensuite viser une clé de production, il faudra d'abord : rendre NEX installable
  par d'autres, publier le site, et accepter l'audit de Riot. On en reparlera à ce moment-là.

---

## 5. Ce que je ne peux pas faire à ta place

Je ne remplis pas le formulaire et je ne crée pas de compte : soumettre une demande en ton nom
demande ton action. Il te reste exactement deux gestes :

1. **Partager la page produit** (menu Partager de l'artifact, accès par lien), puis vérifier
   en navigation privée qu'elle s'ouvre.
2. **Coller** le nom, l'URL et la description de la section 2 dans le formulaire du portail.

Quand la clé arrive, colle-la dans le chat : je l'installe dans `backend/.env` sans l'afficher.
