//! Collecteur en tache de fond (desactive par defaut).
//!
//! Source : joueurs des ligues Challenger / Grand Maitre / Maitre (league-v4) des plateformes
//! configurees, leurs parties classees Solo/Duo recentes (match-v5) et, si active, les timelines.
//! Rythme volontairement lent (une requete Riot au plus toutes les `pace`) pour laisser la
//! priorite aux requetes des utilisateurs, qui partagent les memes limites.

use crate::analytics;
use crate::error::{BResult, BackendError};
use crate::items::{self, ItemClasses};
use crate::riot::{Freshness, RiotClient};
use crate::routes::AppState;
use nex_domain::api::{CollectorStatusDto, MatchDto, TimelineDto};
use nex_domain::riot::{Platform, validate_match_id, validate_puuid};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct CollectorConfig {
    pub enabled: bool,
    pub platforms: Vec<Platform>,
    pub pace: Duration,
    pub timelines: bool,
    /// Joueurs retenus par ligue (les mieux classes).
    pub players_per_tier: usize,
}

pub struct CollectorHandle {
    pub config: CollectorConfig,
    status: Mutex<(Option<i64>, Option<String>)>,
}

impl CollectorHandle {
    pub fn new(config: CollectorConfig) -> Arc<Self> {
        Arc::new(Self { config, status: Mutex::new((None, None)) })
    }

    pub fn status(&self, matches_total: u32) -> CollectorStatusDto {
        let (last, err) = self.status.lock().map(|g| g.clone()).unwrap_or((None, None));
        CollectorStatusDto {
            enabled: self.config.enabled,
            platforms: self.config.platforms.iter().map(|p| p.code().to_string()).collect(),
            matches_total,
            last_ingested_at: last,
            last_error: err,
        }
    }

    fn set_error(&self, e: Option<String>) {
        if let Ok(mut g) = self.status.lock() {
            g.1 = e;
        }
    }

    fn set_ingested(&self) {
        if let Ok(mut g) = self.status.lock() {
            g.0 = Some(crate::store::now_ms());
            g.1 = None;
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeagueList {
    #[serde(default)]
    entries: Vec<LeagueItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeagueItem {
    #[serde(default)]
    puuid: String,
    #[serde(default)]
    league_points: i32,
}

const LEAGUES: [(&str, &str); 3] = [
    ("CHALLENGER", "challengerleagues"),
    ("GRANDMASTER", "grandmasterleagues"),
    ("MASTER", "masterleagues"),
];

/// GET avec rythme : on ne dort que si la donnee n'est pas deja en cache.
async fn paced(s: &AppState, pace: Duration, key: &str, url: reqwest::Url, fresh: Freshness, transform: fn(String) -> BResult<String>) -> BResult<String> {
    let cached = s.riot.store().get(key)?.is_some_and(|c| c.fresh);
    if !cached {
        tokio::time::sleep(pace).await;
    }
    s.riot.get_cached_with(key, url, fresh, false, transform).await
}

fn norm_match(raw: String) -> BResult<String> {
    Ok(serde_json::to_string(&crate::normalize::match_dto(&raw)?)?)
}
fn norm_timeline(raw: String) -> BResult<String> {
    Ok(serde_json::to_string(&crate::normalize::timeline_dto(&raw)?)?)
}

async fn seeds(s: &AppState, cfg: &CollectorConfig, platform: Platform) -> BResult<Vec<(String, &'static str)>> {
    let mut out = Vec::new();
    let host = platform.host();
    for (tier, endpoint) in LEAGUES {
        let url = RiotClient::url(&host, &["lol", "league", "v4", endpoint, "by-queue", "RANKED_SOLO_5x5"], &[])?;
        let key = format!("league-list:{host}:{endpoint}");
        let body = paced(s, cfg.pace, &key, url, Freshness::Ttl(Duration::from_secs(6 * 3600)), Ok).await?;
        let mut list: LeagueList = serde_json::from_str(&body)?;
        list.entries.retain(|e| validate_puuid(&e.puuid).is_ok());
        list.entries.sort_by_key(|e| std::cmp::Reverse(e.league_points));
        out.extend(list.entries.into_iter().take(cfg.players_per_tier).map(|e| (e.puuid, tier)));
    }
    Ok(out)
}

async fn collect_player(s: &AppState, cfg: &CollectorConfig, items: &ItemClasses, platform: Platform, puuid: &str, tier: &str) -> BResult<u32> {
    let region = platform.regional().host();
    let since = (crate::store::now_ms() / 1000 - 14 * 24 * 3600).to_string();
    let url = RiotClient::url(
        region,
        &["lol", "match", "v5", "matches", "by-puuid", puuid, "ids"],
        &[("queue", "420".into()), ("count", "10".into()), ("startTime", since)],
    )?;
    let body = paced(s, cfg.pace, &format!("collect-ids:{puuid}"), url, Freshness::Ttl(Duration::from_secs(1800)), Ok).await?;
    let ids: Vec<String> = serde_json::from_str(&body)?;
    let mut added = 0;
    for id in ids.iter().filter(|id| validate_match_id(id).is_ok()) {
        let known = s.riot.store().with(|c| {
            Ok(c.query_row("SELECT 1 FROM a_matches WHERE match_id = ?1", [id], |_| Ok(())).is_ok())
        })?;
        if known {
            continue;
        }
        let url = RiotClient::url(region, &["lol", "match", "v5", "matches", id], &[])?;
        let m: MatchDto = serde_json::from_str(&paced(s, cfg.pace, &format!("m:v{}:{id}", crate::normalize::NORMALIZE_VERSION), url, Freshness::Immutable, norm_match).await?)?;
        let t: Option<TimelineDto> = if cfg.timelines && !m.remake {
            let url = RiotClient::url(region, &["lol", "match", "v5", "matches", id, "timeline"], &[])?;
            let key = format!("tl:v{}:{id}", crate::normalize::NORMALIZE_VERSION);
            match paced(s, cfg.pace, &key, url, Freshness::Immutable, norm_timeline).await {
                Ok(b) => serde_json::from_str(&b).ok(),
                Err(BackendError::NotFound(_)) => None,
                Err(e) => return Err(e),
            }
        } else {
            None
        };
        if s.riot.store().with(|c| analytics::ingest(c, &m, t.as_ref(), tier, items))? {
            added += 1;
        }
    }
    Ok(added)
}

pub async fn run(state: Arc<AppState>, handle: Arc<CollectorHandle>, http: reqwest::Client) {
    let cfg = handle.config.clone();
    tracing::info!(platforms = ?cfg.platforms.iter().map(|p| p.code()).collect::<Vec<_>>(), pace_ms = cfg.pace.as_millis() as u64, "collecteur demarre");
    let mut items: Option<(ItemClasses, std::time::Instant)> = None;
    loop {
        if items.as_ref().is_none_or(|(_, at)| at.elapsed() > Duration::from_secs(12 * 3600)) {
            match items::fetch(&http).await {
                Ok(c) => items = Some((c, std::time::Instant::now())),
                Err(e) => {
                    handle.set_error(Some(format!("objets Data Dragon : {e}")));
                    tokio::time::sleep(Duration::from_secs(300)).await;
                    continue;
                }
            }
        }
        let classes = &items.as_ref().expect("objets charges").0;
        for platform in &cfg.platforms {
            let players = match seeds(&state, &cfg, *platform).await {
                Ok(p) => p,
                Err(e) => {
                    handle_error(&handle, e).await;
                    continue;
                }
            };
            for (puuid, tier) in players {
                match collect_player(&state, &cfg, classes, *platform, &puuid, tier).await {
                    Ok(n) if n > 0 => {
                        handle.set_ingested();
                        tracing::debug!(n, "parties ingerees");
                    }
                    Ok(_) => {}
                    Err(e) => handle_error(&handle, e).await,
                }
            }
        }
        // Tour complet termine : pause avant de recommencer.
        tokio::time::sleep(Duration::from_secs(600)).await;
    }
}

async fn handle_error(handle: &CollectorHandle, e: BackendError) {
    let msg = e.to_string();
    tracing::warn!("collecteur : {msg}");
    handle.set_error(Some(msg));
    let wait = match e {
        BackendError::RateLimited(s) => Duration::from_secs(s.max(5)),
        BackendError::Unavailable(_) => Duration::from_secs(600),
        _ => Duration::from_secs(10),
    };
    tokio::time::sleep(wait).await;
}
