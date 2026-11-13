# Backend NEX

Service HTTP (Rust, axum) qui **détient la clé Riot**. L'application desktop ne contacte jamais les API Riot directement.

## Lancement local

```bash
npm run backend
```

Depuis la racine du dépôt, le backend lit **uniquement** `backend/.env` (copie de `backend/.env.example`). Il ne cherche jamais de `.env` dans les dossiers parents. Il écoute par défaut sur `http://127.0.0.1:8787`, et son cache SQLite est `backend/nex-backend.sqlite3`.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `RIOT_API_KEY` | Clé Riot (`RGAPI-…`). Jamais journalisée, jamais renvoyée. | – |
| `NEX_BACKEND_BIND` | Adresse d'écoute | `127.0.0.1:8787` |
| `NEX_BACKEND_DB` | Fichier de cache | `backend/nex-backend.sqlite3` |
| `RIOT_MAX_CONCURRENCY` | Requêtes Riot simultanées | 4 |
| `RIOT_APP_LIMITS` | Fenêtres `n:secondes` | `20:1,100:120` |

Une clé de développement Riot expire au bout de 24 h. Le backend répond alors `503 unavailable` (« clé Riot refusée ou expirée »).

## API `/v1`

| Route | Riot appelé | Cache |
| --- | --- | --- |
| `GET /v1/health` | – | – |
| `GET /v1/players/{platform}/{gameName}/{tagLine}?refresh=true` | account-v1, summoner-v4, league-v4 | 1 h / 10 min / 2 min |
| `GET /v1/matches/{platform}/by-puuid/{puuid}?start&count&queue&timelines` | match-v5 ids, matchs, timelines (≤ 10) | ids 60 s, matchs et timelines immuables |
| `GET /v1/match/{platform}/{matchId}` | match-v5 | immuable |
| `GET /v1/match/{platform}/{matchId}/timeline` | match-v5 timeline | immuable |
| `GET /v1/leaderboard/{platform}?queue=RANKED_SOLO_5x5\|RANKED_FLEX_SR&tier=CHALLENGER\|GRANDMASTER\|MASTER&page` | league-v4, account-v1 (noms) | 30 min / noms 24 h |
| `GET /v1/live/{platform}/{puuid}` | spectator-v5 | 30 s |

Le backend n'accepte que les requêtes adressées à un hôte de boucle locale (`127.0.0.1`, `localhost`, `[::1]`). Il refuse les requêtes intersites des navigateurs (`Sec-Fetch-Site` différent de `same-origin` ou `none`) avec un `403 forbidden`. Cela protège la clé et le quota Riot contre le DNS rebinding et les sites web malveillants.

Les erreurs ont toujours la forme `{ code, message, retryAfterSecs? }` : `invalid_input` (400), `not_found` (404), `rate_limited` (429 + `Retry-After`), `unavailable` (503), `upstream` (502).

## Statistiques agrégées

| Route | Paramètres |
| --- | --- |
| `GET /v1/stats/meta` | – : patchs, régions et rangs disponibles avec effectifs, état du collecteur |
| `GET /v1/stats/tierlist` | `patch` (vide = dernier, `all`), `queue` (420/440), `platform`, `tier`, `position` |
| `GET /v1/stats/champion/{id}/build` | idem |
| `GET /v1/stats/champion/{id}/matchups` | idem |

Collecteur (désactivé par défaut) : `NEX_COLLECTOR=on`, `NEX_COLLECTOR_PLATFORMS=EUW1,KR`, `NEX_COLLECTOR_PACE_MS` (plancher 1 200 ms), `NEX_COLLECTOR_TIMELINES`, `NEX_COLLECTOR_PLAYERS`. La méthode est décrite dans [docs/METHODE_STATISTIQUE.md](../docs/METHODE_STATISTIQUE.md).

Observation du 7 novembre 2026 : Riot renvoie environ un 429 par minute sur `match-v5 …/timeline` avec `X-Rate-Limit-Type: server`. Il s'agit d'un étranglement côté Riot, pas d'un dépassement du quota de la clé. Le backend respecte `Retry-After` (3 à 10 s) puis reprend. Le type de limite est journalisé à chaque 429.

Une clé de **développement** Riot sert au développement, pas à une collecte à grande échelle. Une mise en production exigera une clé produit enregistrée auprès de Riot.

## Garanties

- Toutes les entrées sont validées (Riot ID, plateforme, PUUID, identifiant de match, pagination). Chaque segment d'URL vers Riot est encodé.
- Limites de débit à fenêtres glissantes et concurrence bornée. Après un 429, Riot est bloqué pendant la durée `Retry-After`.
- Une seule requête Riot par clé de cache à la fois : les appels identiques sont mutualisés.
- Si Riot est en panne, le backend sert la dernière valeur connue, même expirée.
- Les matchs et timelines sont stockés **normalisés** et versionnés (`m:v1:…`, `tl:v1:…`) pour éviter de garder les réponses brutes volumineuses.

## Pas encore en place, nécessaire avant toute exposition publique

- Authentification des clients et limites par client : aujourd'hui, une adresse d'écoute non locale déclenche un avertissement.
- HTTPS (reverse proxy), journalisation structurée et supervision.
- File de tâches et stockage analytique pour les agrégats globaux (tier lists, matchups) : collecte autorisée à concevoir à l'étape 3.
- Enregistrement du produit auprès de Riot et clé de production.
