//! Routes HTTP `/v1`. Toutes les entrees sont validees avant tout appel Riot.

use crate::error::{BResult, BackendError};
use crate::normalize::{self, NORMALIZE_VERSION, RAccount, RSummoner};
use crate::riot::{Freshness, RiotClient};
use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use nex_domain::api::*;
use nex_domain::riot::{Platform, RiotId, validate_match_id, validate_puuid};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

pub struct AppState {
    pub riot: RiotClient,
    pub collector: Arc<crate::collector::CollectorHandle>,
}

pub type Shared = Arc<AppState>;

const HOUR: Duration = Duration::from_secs(3600);

pub fn router(state: Shared) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/players/{platform}/{game_name}/{tag_line}", get(player))
        .route("/v1/matches/{platform}/by-puuid/{puuid}", get(match_page))
        .route("/v1/match/{platform}/{match_id}", get(match_one))
        .route("/v1/match/{platform}/{match_id}/timeline", get(timeline))
        .route("/v1/ranks/{platform}/{puuid}", get(rank_history))
        .route("/v1/leaderboard/{platform}", get(leaderboard))
        .route("/v1/pro/teams", get(crate::pro::get_teams))
        .route("/v1/live/{platform}/{puuid}", get(live_game))
        .route("/v1/mayhem/catalog", get(crate::mayhem::get_catalog))
        .route("/v1/mayhem/rules", get(crate::mayhem::get_rules))
        .route("/v1/mayhem/dataset", get(crate::mayhem::get_dataset))
        .route("/v1/mayhem/rate", axum::routing::post(crate::mayhem::post_rate))
        .route("/v1/stats/meta", get(stats_meta))
        .route("/v1/stats/tierlist", get(stats_tierlist))
        .route("/v1/stats/baselines", get(stats_baselines))
        .route("/v1/stats/champion/{champion_id}/build", get(stats_build))
        .route("/v1/stats/champion/{champion_id}/matchups", get(stats_matchups))
        .layer(axum::middleware::from_fn(local_only))
        .with_state(state)
}

/// Le backend local ne repond qu'a l'application NEX (et a l'apercu Vite) :
/// - `Host` doit etre une adresse de boucle locale : bloque le DNS rebinding, ou un site
///   pointe son domaine vers 127.0.0.1 pour lire les reponses ;
/// - `Sec-Fetch-Site` (envoye par les navigateurs) doit etre `same-origin` ou `none` : un autre
///   site ne peut pas consommer le quota Riot via des requetes intersites.
///
/// Les clients non navigateurs (noyau Rust de NEX) n'envoient pas `Sec-Fetch-Site`.
pub fn check_local(headers: &axum::http::HeaderMap) -> BResult<()> {
    if let Some(host) = headers.get(axum::http::header::HOST) {
        let host = host.to_str().unwrap_or("");
        let name = if let Some(rest) = host.strip_prefix('[') {
            rest.split(']').next().unwrap_or("")
        } else {
            host.rsplit_once(':').map_or(host, |(h, _)| h)
        };
        if !matches!(name.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost" | "::1") {
            return Err(BackendError::Forbidden("hote non autorise".into()));
        }
    }
    if let Some(site) = headers.get("sec-fetch-site") {
        if !matches!(site.to_str().unwrap_or(""), "same-origin" | "none") {
            return Err(BackendError::Forbidden("requete intersite refusee".into()));
        }
    }
    Ok(())
}

async fn local_only(req: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    use axum::response::IntoResponse;
    match check_local(req.headers()) {
        Ok(()) => next.run(req).await,
        Err(e) => e.into_response(),
    }
}

// ---------- Classements ----------

#[derive(Deserialize, Default)]
#[serde(default)]
struct BoardQuery {
    queue: Option<String>,
    tier: Option<String>,
    page: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RLeagueList {
    #[serde(default)]
    entries: Vec<RLeagueItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RLeagueItem {
    #[serde(default)]
    puuid: String,
    #[serde(default)]
    league_points: i32,
    #[serde(default)]
    wins: u32,
    #[serde(default)]
    losses: u32,
    #[serde(default)]
    hot_streak: bool,
}

pub const BOARD_PAGE: u32 = 25;

async fn leaderboard(State(s): State<Shared>, Path(platform): Path<String>, Query(q): Query<BoardQuery>) -> BResult<Json<LeaderboardDto>> {
    let platform = Platform::parse(&platform)?;
    let queue = match q.queue.as_deref().unwrap_or("RANKED_SOLO_5x5") {
        v @ ("RANKED_SOLO_5x5" | "RANKED_FLEX_SR") => v.to_string(),
        _ => return Err(BackendError::InvalidInput("file inconnue".into())),
    };
    let (tier, endpoint) = match q.tier.as_deref().unwrap_or("CHALLENGER") {
        "CHALLENGER" => ("CHALLENGER", "challengerleagues"),
        "GRANDMASTER" => ("GRANDMASTER", "grandmasterleagues"),
        "MASTER" => ("MASTER", "masterleagues"),
        _ => return Err(BackendError::InvalidInput("palier inconnu (CHALLENGER, GRANDMASTER, MASTER)".into())),
    };
    let page = q.page.unwrap_or(1).clamp(1, 400);
    let host = platform.host();
    let url = RiotClient::url(&host, &["lol", "league", "v4", endpoint, "by-queue", &queue], &[])?;
    let key = format!("board:{host}:{endpoint}:{queue}");
    let body = s.riot.get_cached(&key, url, Freshness::Ttl(Duration::from_secs(1800)), false).await?;
    let fetched_at = s.riot.store().get(&key)?.map(|c| c.fetched_at).unwrap_or_else(crate::store::now_ms);
    let mut list: RLeagueList = serde_json::from_str(&body)?;
    list.entries.retain(|e| validate_puuid(&e.puuid).is_ok());
    // Ordre officiel : LP decroissants, puis victoires.
    list.entries.sort_by(|a, b| b.league_points.cmp(&a.league_points).then(b.wins.cmp(&a.wins)));
    let total = list.entries.len() as u32;
    let start = ((page - 1) * BOARD_PAGE) as usize;
    let slice: Vec<(u32, RLeagueItem)> = list.entries.into_iter().enumerate().skip(start).take(BOARD_PAGE as usize).map(|(i, e)| (i as u32 + 1, e)).collect();

    // Riot ID (account-v1) et icone d'invocateur (summoner-v4) par PUUID, en parallele, cache
    // 24 h ; un echec laisse le nom vide ou l'icone absente, jamais une valeur inventee.
    let route = platform.account_route().host();
    let mut set = tokio::task::JoinSet::new();
    for (i, (_, e)) in slice.iter().enumerate() {
        let s = s.clone();
        let puuid = e.puuid.clone();
        let host = host.clone();
        set.spawn(async move {
            let name = async {
                let url = RiotClient::url(route, &["riot", "account", "v1", "accounts", "by-puuid", &puuid], &[]).ok()?;
                let body = s.riot.get_cached(&format!("acct-by-puuid:{route}:{puuid}"), url, Freshness::Ttl(Duration::from_secs(86_400)), false).await.ok()?;
                let a: RAccount = serde_json::from_str(&body).ok()?;
                Some((a.game_name, a.tag_line))
            };
            let icon = async {
                let url = RiotClient::url(&host, &["lol", "summoner", "v4", "summoners", "by-puuid", &puuid], &[]).ok()?;
                let body = s.riot.get_cached(&format!("summ-icon:{host}:{puuid}"), url, Freshness::Ttl(Duration::from_secs(86_400)), false).await.ok()?;
                let sm: RSummoner = serde_json::from_str(&body).ok()?;
                Some(sm.profile_icon_id)
            };
            let (name, icon) = tokio::join!(name, icon);
            (i, name, icon)
        });
    }
    let mut names = vec![(String::new(), String::new()); slice.len()];
    let mut icons: Vec<Option<u32>> = vec![None; slice.len()];
    while let Some(Ok((i, name, icon))) = set.join_next().await {
        if let Some(n) = name {
            names[i] = n;
        }
        icons[i] = icon;
    }
    let entries = slice
        .into_iter()
        .zip(names)
        .zip(icons)
        .map(|(((rank, e), (game_name, tag_line)), profile_icon_id)| LeaderboardEntryDto {
            rank,
            puuid: e.puuid,
            game_name,
            tag_line,
            lp: e.league_points,
            wins: e.wins,
            losses: e.losses,
            hot_streak: e.hot_streak,
            profile_icon_id,
        })
        .collect();
    Ok(Json(LeaderboardDto { platform: platform.code().into(), queue, tier: tier.into(), page, page_size: BOARD_PAGE, total, fetched_at, entries }))
}

// ---------- Partie en cours (spectator-v5) ----------

async fn live_game(State(s): State<Shared>, Path((platform, puuid)): Path<(String, String)>) -> BResult<Json<LiveGameDto>> {
    let platform = Platform::parse(&platform)?;
    validate_puuid(&puuid)?;
    let host = platform.host();
    let url = RiotClient::url(&host, &["lol", "spectator", "v5", "active-games", "by-summoner", &puuid], &[])?;
    let now = crate::store::now_ms();
    let body = match s.riot.get_cached(&format!("live:{host}:{puuid}"), url, Freshness::Ttl(Duration::from_secs(30)), false).await {
        Ok(b) => b,
        // 404 = pas en partie (etat reel, pas une erreur).
        Err(BackendError::NotFound(_)) => {
            return Ok(Json(LiveGameDto {
                in_game: false,
                game_id: None,
                queue_id: None,
                game_mode: None,
                start_time: None,
                participants: vec![],
                fetched_at: now,
            }));
        }
        Err(e) => return Err(e),
    };
    let v: serde_json::Value = serde_json::from_str(&body)?;
    let participants = v
        .get("participants")
        .and_then(|p| p.as_array())
        .map(|a| {
            a.iter()
                .map(|p| LiveParticipantDto {
                    puuid: p.get("puuid").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                    riot_id: p.get("riotId").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                    champion_id: p.get("championId").and_then(|x| x.as_i64()).unwrap_or(0) as i32,
                    team_id: p.get("teamId").and_then(|x| x.as_u64()).unwrap_or(0) as u16,
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Json(LiveGameDto {
        in_game: true,
        game_id: v.get("gameId").and_then(|x| x.as_i64()),
        queue_id: v.get("gameQueueConfigId").and_then(|x| x.as_u64()).map(|x| x as u32),
        game_mode: v.get("gameMode").and_then(|x| x.as_str()).map(str::to_string),
        start_time: v.get("gameStartTime").and_then(|x| x.as_i64()),
        participants,
        fetched_at: now,
    }))
}

// ---------- Statistiques agregees ----------

#[derive(Deserialize, Default)]
#[serde(default)]
struct StatsQuery {
    patch: Option<String>,
    platform: Option<String>,
    queue: Option<u32>,
    tier: Option<String>,
    position: Option<String>,
}

impl StatsQuery {
    fn filter(&self, conn: &rusqlite::Connection) -> BResult<crate::analytics::Filter> {
        crate::analytics::Filter::resolve(conn, self.patch.as_deref(), self.platform.as_deref(), self.queue, self.tier.as_deref())
    }
    fn position(&self) -> BResult<Option<&str>> {
        match self.position.as_deref() {
            None | Some("") | Some("ALL") => Ok(None),
            Some(p) if crate::analytics::POSITIONS.contains(&p) => Ok(Some(p)),
            Some(_) => Err(BackendError::InvalidInput("poste inconnu".into())),
        }
    }
}

fn champion_id(raw: &str) -> BResult<i32> {
    raw.parse::<i32>()
        .ok()
        .filter(|id| (1..=10_000).contains(id))
        .ok_or_else(|| BackendError::InvalidInput("identifiant de champion invalide".into()))
}

async fn stats_meta(State(s): State<Shared>) -> BResult<Json<StatsMetaDto>> {
    let total: u32 = s.riot.store().with(|c| Ok(c.query_row("SELECT COUNT(*) FROM a_matches", [], |r| r.get(0))?))?;
    let status = s.collector.status(total);
    Ok(Json(s.riot.store().with(|c| crate::analytics::meta(c, status))?))
}

async fn stats_tierlist(State(s): State<Shared>, Query(q): Query<StatsQuery>) -> BResult<Json<TierListDto>> {
    let pos = q.position()?;
    Ok(Json(s.riot.store().with(|c| {
        let f = q.filter(c)?;
        crate::analytics::tier_list(c, &f, pos)
    })?))
}

/// Medianes des mesures du Data Studio sur les parties collectees par NEX.
async fn stats_baselines(State(s): State<Shared>, Query(q): Query<StatsQuery>) -> BResult<Json<BaselinesDto>> {
    let pos = q.position()?;
    Ok(Json(s.riot.store().with(|c| {
        let f = q.filter(c)?;
        crate::analytics::baselines(c, &f, pos)
    })?))
}

async fn stats_build(State(s): State<Shared>, Path(id): Path<String>, Query(q): Query<StatsQuery>) -> BResult<Json<ChampionBuildDto>> {
    let id = champion_id(&id)?;
    let pos = q.position()?;
    Ok(Json(s.riot.store().with(|c| {
        let f = q.filter(c)?;
        crate::analytics::champion_build(c, &f, id, pos)
    })?))
}

async fn stats_matchups(State(s): State<Shared>, Path(id): Path<String>, Query(q): Query<StatsQuery>) -> BResult<Json<MatchupsDto>> {
    let id = champion_id(&id)?;
    let pos = q.position()?;
    Ok(Json(s.riot.store().with(|c| {
        let f = q.filter(c)?;
        crate::analytics::matchups(c, &f, id, pos)
    })?))
}

async fn health(State(s): State<Shared>) -> Json<HealthDto> {
    Json(HealthDto {
        service: "nex-backend".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        riot_key_configured: s.riot.key_configured(),
    })
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ProfileQuery {
    refresh: bool,
}

fn not_found_as(e: BackendError, msg: &str) -> BackendError {
    match e {
        BackendError::NotFound(_) => BackendError::NotFound(msg.into()),
        e => e,
    }
}

async fn player(
    State(s): State<Shared>,
    Path((platform, game_name, tag_line)): Path<(String, String, String)>,
    Query(q): Query<ProfileQuery>,
) -> BResult<Json<PlayerProfileDto>> {
    let platform = Platform::parse(&platform)?;
    let id = RiotId::new(&game_name, &tag_line)?;
    let route = platform.account_route().host();

    let url = RiotClient::url(route, &["riot", "account", "v1", "accounts", "by-riot-id", &id.game_name, &id.tag_line], &[])?;
    let key = format!("acct:{route}:{}#{}", id.game_name.to_lowercase(), id.tag_line.to_lowercase());
    let body = s
        .riot
        .get_cached(&key, url, Freshness::Ttl(HOUR), q.refresh)
        .await
        .map_err(|e| not_found_as(e, "Riot ID introuvable"))?;
    let account: RAccount = serde_json::from_str(&body)?;
    validate_puuid(&account.puuid).map_err(|_| BackendError::Upstream("PUUID Riot inattendu".into()))?;

    let host = platform.host();
    let url = RiotClient::url(&host, &["lol", "summoner", "v4", "summoners", "by-puuid", &account.puuid], &[])?;
    let body = s
        .riot
        .get_cached(&format!("summ:{host}:{}", account.puuid), url, Freshness::Ttl(Duration::from_secs(600)), q.refresh)
        .await
        .map_err(|e| not_found_as(e, "aucun compte League of Legends sur cette région pour ce Riot ID"))?;
    let summoner: RSummoner = serde_json::from_str(&body)?;

    let url = RiotClient::url(&host, &["lol", "league", "v4", "entries", "by-puuid", &account.puuid], &[])?;
    let body = s
        .riot
        .get_cached(&format!("league:{host}:{}", account.puuid), url, Freshness::Ttl(Duration::from_secs(120)), q.refresh)
        .await?;
    let ranks = normalize::league_entries(&body)?;

    // Historique des LP : Riot ne sert que le rang courant. Chaque lecture de profil enregistre
    // ce qu'elle voit, sans requete supplementaire ; seuls les changements creent une ligne.
    // Une ecriture qui echoue ne doit pas priver l'appelant de son profil.
    for r in &ranks {
        if let Err(e) = s.riot.store().put_rank(platform.code(), &account.puuid, &r.queue, &r.tier, r.division.as_deref(), r.lp, r.wins, r.losses) {
            tracing::warn!("relevé de rang non enregistré : {e}");
        }
    }

    Ok(Json(PlayerProfileDto {
        puuid: account.puuid,
        game_name: if account.game_name.is_empty() { id.game_name } else { account.game_name },
        tag_line: if account.tag_line.is_empty() { id.tag_line } else { account.tag_line },
        platform: platform.code().into(),
        level: summoner.summoner_level,
        profile_icon_id: summoner.profile_icon_id,
        ranks,
        fetched_at: crate::store::now_ms(),
    }))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RanksQuery {
    queue: Option<String>,
}

/// Releves de rang deja observes par NEX pour ce joueur. Aucune requete Riot : ce que le
/// backend n'a pas vu passer n'existe pas, et la liste est alors vide.
async fn rank_history(State(s): State<Shared>, Path((platform, puuid)): Path<(String, String)>, Query(q): Query<RanksQuery>) -> BResult<Json<Vec<RankSnapshotDto>>> {
    let platform = Platform::parse(&platform)?;
    validate_puuid(&puuid)?;
    let queue = match q.queue.as_deref() {
        None | Some("") => "",
        Some(v @ ("RANKED_SOLO_5x5" | "RANKED_FLEX_SR")) => v,
        Some(_) => return Err(BackendError::InvalidInput("file inconnue".into())),
    };
    Ok(Json(s.riot.store().ranks(platform.code(), &puuid, queue, 2000)?))
}

fn match_key(id: &str) -> String {
    format!("m:v{NORMALIZE_VERSION}:{id}")
}
fn timeline_key(id: &str) -> String {
    format!("tl:v{NORMALIZE_VERSION}:{id}")
}

async fn load_timeline(s: &AppState, platform: Platform, match_id: &str) -> BResult<TimelineDto> {
    let url = RiotClient::url(platform.regional().host(), &["lol", "match", "v5", "matches", match_id, "timeline"], &[])?;
    let body = s
        .riot
        .get_cached_with(&timeline_key(match_id), url, Freshness::Immutable, false, |raw| {
            Ok(serde_json::to_string(&normalize::timeline_dto(&raw)?)?)
        })
        .await?;
    Ok(serde_json::from_str(&body)?)
}

async fn load_match(s: &AppState, platform: Platform, match_id: &str, with_timeline: bool) -> BResult<MatchDto> {
    let url = RiotClient::url(platform.regional().host(), &["lol", "match", "v5", "matches", match_id], &[])?;
    let body = s
        .riot
        .get_cached_with(&match_key(match_id), url, Freshness::Immutable, false, |raw| {
            Ok(serde_json::to_string(&normalize::match_dto(&raw)?)?)
        })
        .await?;
    let mut m: MatchDto = serde_json::from_str(&body)?;

    // Or a 15 min : timeline deja connue, ou demandee explicitement.
    let timeline = if let Some(c) = s.riot.store().get(&timeline_key(match_id))? {
        serde_json::from_str::<TimelineDto>(&c.body).ok()
    } else if with_timeline && !m.remake {
        load_timeline(s, platform, match_id).await.ok()
    } else {
        None
    };
    if let Some(t) = timeline {
        m.gold_at_15 = normalize::gold_at_15(&m, &t);
    }
    Ok(m)
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct PageQuery {
    start: u32,
    count: Option<u32>,
    queue: Option<u32>,
    /// Nombre de parties (les plus recentes de la page) dont la timeline est chargee. Max 10.
    timelines: u32,
}

async fn match_page(
    State(s): State<Shared>,
    Path((platform, puuid)): Path<(String, String)>,
    Query(q): Query<PageQuery>,
) -> BResult<Json<MatchPageDto>> {
    let platform = Platform::parse(&platform)?;
    validate_puuid(&puuid)?;
    let count = q.count.unwrap_or(10).clamp(1, 20);
    if q.start > 1000 {
        return Err(BackendError::InvalidInput("start doit etre <= 1000".into()));
    }
    let timelines = q.timelines.min(10).min(count);

    let mut query = vec![("start", q.start.to_string()), ("count", count.to_string())];
    if let Some(queue) = q.queue {
        query.push(("queue", queue.to_string()));
    }
    let url = RiotClient::url(platform.regional().host(), &["lol", "match", "v5", "matches", "by-puuid", &puuid, "ids"], &query)?;
    let key = format!("ids:{puuid}:{}:{count}:{}", q.start, q.queue.map(|x| x.to_string()).unwrap_or_default());
    let body = s.riot.get_cached(&key, url, Freshness::Ttl(Duration::from_secs(60)), false).await?;
    let ids: Vec<String> = serde_json::from_str(&body)?;
    let ids: Vec<String> = ids.into_iter().filter(|id| validate_match_id(id).is_ok()).collect();

    // Chargement concurrent ; la concurrence reelle vers Riot reste bornee par le client.
    let mut set = tokio::task::JoinSet::new();
    for (i, id) in ids.iter().enumerate() {
        let s = s.clone();
        let id = id.clone();
        let with_tl = (i as u32) < timelines;
        set.spawn(async move { (i, load_match(&s, platform, &id, with_tl).await) });
    }
    let mut out: Vec<(usize, MatchDto)> = Vec::with_capacity(ids.len());
    while let Some(joined) = set.join_next().await {
        let (i, res) = joined.map_err(|e| BackendError::Internal(e.to_string()))?;
        match res {
            Ok(m) => out.push((i, m)),
            Err(BackendError::NotFound(_)) => {} // match purge chez Riot : ignore
            Err(e) => return Err(e),
        }
    }
    out.sort_by_key(|(i, _)| *i);
    Ok(Json(MatchPageDto {
        has_more: ids.len() as u32 == count,
        matches: out.into_iter().map(|(_, m)| m).collect(),
        start: q.start,
        count,
    }))
}

async fn match_one(State(s): State<Shared>, Path((platform, match_id)): Path<(String, String)>) -> BResult<Json<MatchDto>> {
    let platform = Platform::parse(&platform)?;
    validate_match_id(&match_id)?;
    Ok(Json(load_match(&s, platform, &match_id, false).await?))
}

async fn timeline(State(s): State<Shared>, Path((platform, match_id)): Path<(String, String)>) -> BResult<Json<TimelineDto>> {
    let platform = Platform::parse(&platform)?;
    validate_match_id(&match_id)?;
    Ok(Json(load_timeline(&s, platform, &match_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn app(key: Option<&str>) -> (Router, Arc<Store>) {
        let store = Arc::new(Store::memory().unwrap());
        store.with(crate::analytics::init).unwrap();
        let riot = RiotClient::new(key.map(str::to_string), &[(20, 1)], 2, store.clone());
        let collector = crate::collector::CollectorHandle::new(crate::collector::CollectorConfig {
            enabled: false,
            platforms: vec![],
            pace: std::time::Duration::from_secs(2),
            timelines: false,
            players_per_tier: 1,
        });
        (router(Arc::new(AppState { riot, collector })), store)
    }

    #[tokio::test]
    async fn leaderboard_and_live_validation() {
        let (a, _) = app(None);
        let (st, _) = call(a, "/v1/leaderboard/EUW1?tier=IRON").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (a, _) = app(None);
        let (st, _) = call(a, "/v1/leaderboard/EUW1?queue=ARAM").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (a, _) = app(None);
        let (st, body) = call(a, "/v1/leaderboard/EUW1").await;
        assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE, "{body}");
        let (a, _) = app(None);
        let (st, _) = call(a, "/v1/live/EUW1/short").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn leaderboard_from_cache_sorted_without_names() {
        let (a, store) = app(None);
        let p = |c: char| std::iter::repeat_n(c, 78).collect::<String>();
        let body = serde_json::json!({"entries": [
            {"puuid": p('a'), "leaguePoints": 900, "wins": 100, "losses": 50},
            {"puuid": p('b'), "leaguePoints": 1500, "wins": 200, "losses": 90, "hotStreak": true},
            {"puuid": "invalide", "leaguePoints": 9999}
        ]});
        store.put("board:euw1:challengerleagues:RANKED_SOLO_5x5", &body.to_string(), Some(60_000)).unwrap();
        let (st, v) = call(a, "/v1/leaderboard/EUW1").await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(v["total"], 2);
        assert_eq!(v["entries"][0]["lp"], 1500);
        assert_eq!(v["entries"][0]["rank"], 1);
        assert_eq!(v["entries"][0]["hotStreak"], true);
        // Sans cle Riot, les noms ne sont pas resolus : vides, jamais inventes.
        assert_eq!(v["entries"][0]["gameName"], "");
    }

    #[tokio::test]
    async fn stats_endpoints_validate_and_answer_empty() {
        let (a, _) = app(None);
        let (st, body) = call(a, "/v1/stats/meta").await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body["collector"]["enabled"], false);
        let (a, _) = app(None);
        let (st, body) = call(a, "/v1/stats/tierlist?queue=420").await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body["scope"]["matches"], 0);
        let (a, _) = app(None);
        let (st, _) = call(a, "/v1/stats/tierlist?position=SUPPORT").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (a, _) = app(None);
        let (st, _) = call(a, "/v1/stats/champion/abc/build").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (a, _) = app(None);
        let (st, body) = call(a, "/v1/stats/champion/103/matchups?position=MIDDLE").await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body["matchups"], serde_json::json!([]));
    }

    async fn call(app: Router, uri: &str) -> (StatusCode, serde_json::Value) {
        let resp = app.oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), 1 << 20).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
    }

    #[tokio::test]
    async fn rejects_foreign_hosts_and_cross_site() {
        let req = |host: &str, site: Option<&str>| {
            let mut b = Request::get("/v1/health").header("host", host);
            if let Some(s) = site {
                b = b.header("sec-fetch-site", s);
            }
            b.body(Body::empty()).unwrap()
        };
        let cases = [
            ("127.0.0.1:8787", None, StatusCode::OK),
            ("localhost:1420", Some("same-origin"), StatusCode::OK),
            ("[::1]:8787", None, StatusCode::OK),
            ("evil.example", None, StatusCode::FORBIDDEN),
            ("127.0.0.1.evil.example:8787", None, StatusCode::FORBIDDEN),
            ("127.0.0.1:8787", Some("cross-site"), StatusCode::FORBIDDEN),
            ("localhost:8787", Some("same-site"), StatusCode::FORBIDDEN),
        ];
        for (host, site, want) in cases {
            let (a, _) = app(None);
            let resp = a.oneshot(req(host, site)).await.unwrap();
            assert_eq!(resp.status(), want, "{host} {site:?}");
        }
    }

    #[tokio::test]
    async fn health_never_exposes_key() {
        let (app, _) = app(Some("RGAPI-secret-value"));
        let (st, body) = call(app, "/v1/health").await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body["riotKeyConfigured"], true);
        assert!(!body.to_string().contains("secret"));
    }

    #[tokio::test]
    async fn validation_errors() {
        let (a, _) = app(None);
        let (st, body) = call(a, "/v1/players/XX9/Faker/KR1").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        assert_eq!(body["code"], "invalid_input");
        let (a, _) = app(None);
        let (st, _) = call(a, "/v1/match/EUW1/not-a-match").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
        let (a, _) = app(None);
        let (st, _) = call(a, "/v1/matches/EUW1/by-puuid/short").await;
        assert_eq!(st, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn missing_key_is_503() {
        let (a, _) = app(None);
        let (st, body) = call(a, "/v1/players/EUW1/Some%20Player/EUW").await;
        assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["code"], "unavailable");
    }

    #[tokio::test]
    async fn match_from_cache_with_gold_at_15() {
        let (a, store) = app(None);
        let m = normalize::match_dto(include_str!("../tests/fixtures/match.json")).unwrap();
        let t = normalize::timeline_dto(include_str!("../tests/fixtures/timeline.json")).unwrap();
        store.put(&match_key(&m.id), &serde_json::to_string(&m).unwrap(), None).unwrap();
        store.put(&timeline_key(&m.id), &serde_json::to_string(&t).unwrap(), None).unwrap();
        let (st, body) = call(a, "/v1/match/EUW1/EUW1_7000000001").await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body["goldAt15"], serde_json::json!([6200, 5400]));
        assert_eq!(body["participants"][0]["champion"], "Ahri");
    }
}
