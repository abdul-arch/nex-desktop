//! Adaptateur vers le backend NEX. L'app n'appelle jamais les API Riot directement :
//! la cle reste sur le backend. Reponses validees par les types partages (nex-domain).

use crate::error::{AppError, AppResult};
use crate::persistence::{Db, cache};
use nex_domain::api::{ApiError, HealthDto, MatchDto, MatchPageDto, PlayerProfileDto, TimelineDto};
use serde::de::DeserializeOwned;
use std::time::Duration;

fn build_url(base: &str, segments: &[&str], query: &[(&str, String)]) -> AppResult<reqwest::Url> {
    let mut url = reqwest::Url::parse(base).map_err(|_| AppError::InvalidInput("URL du backend invalide".into()))?;
    url.path_segments_mut()
        .map_err(|_| AppError::InvalidInput("URL du backend invalide".into()))?
        .pop_if_empty()
        .extend(segments);
    if !query.is_empty() {
        let mut q = url.query_pairs_mut();
        for (k, v) in query {
            q.append_pair(k, v);
        }
    }
    Ok(url)
}

fn map_api_error(status: reqwest::StatusCode, body: &str) -> AppError {
    match serde_json::from_str::<ApiError>(body) {
        Ok(e) => match e.code.as_str() {
            "invalid_input" => AppError::InvalidInput(e.message),
            "not_found" => AppError::NotFound(e.message),
            "rate_limited" => AppError::RateLimited { retry_after_secs: e.retry_after_secs.unwrap_or(10) },
            "unavailable" => AppError::Unavailable(e.message),
            _ => AppError::Unavailable(format!("Riot indisponible : {}", e.message)),
        },
        Err(_) => AppError::Unavailable(format!("reponse inattendue du backend ({})", status.as_u16())),
    }
}

async fn get_json<T: DeserializeOwned>(
    http: &reqwest::Client,
    base: &str,
    segments: &[&str],
    query: &[(&str, String)],
    timeout: Duration,
) -> AppResult<T> {
    let url = build_url(base, segments, query)?;
    let resp = http.get(url).timeout(timeout).send().await.map_err(|e| {
        if e.is_connect() {
            AppError::Unavailable(format!("backend NEX injoignable ({base}). Lance-le avec : cargo run -p nex-backend"))
        } else if e.is_timeout() {
            AppError::Network("le backend NEX ne repond pas (delai depasse)".into())
        } else {
            AppError::Network("erreur de connexion au backend NEX".into())
        }
    })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|_| AppError::Network("lecture de la reponse du backend".into()))?;
    if !status.is_success() {
        return Err(map_api_error(status, &body));
    }
    serde_json::from_str(&body).map_err(|e| AppError::Unavailable(format!("reponse du backend illisible : {e}")))
}

pub async fn health(http: &reqwest::Client, base: &str) -> AppResult<HealthDto> {
    get_json(http, base, &["v1", "health"], &[], Duration::from_secs(4)).await
}

pub async fn player(http: &reqwest::Client, base: &str, platform: &str, name: &str, tag: &str, refresh: bool) -> AppResult<PlayerProfileDto> {
    let q = if refresh { vec![("refresh", "true".to_string())] } else { vec![] };
    get_json(http, base, &["v1", "players", platform, name, tag], &q, Duration::from_secs(20)).await
}

pub async fn matches(
    http: &reqwest::Client,
    base: &str,
    platform: &str,
    puuid: &str,
    start: u32,
    count: u32,
    queue: Option<u32>,
    timelines: u32,
) -> AppResult<MatchPageDto> {
    let mut q = vec![("start", start.to_string()), ("count", count.to_string()), ("timelines", timelines.to_string())];
    if let Some(queue) = queue {
        q.push(("queue", queue.to_string()));
    }
    // Une page avec timelines peut attendre les limites de debit Riot : delai plus long.
    get_json(http, base, &["v1", "matches", platform, "by-puuid", puuid], &q, Duration::from_secs(60)).await
}

pub async fn pro_teams(http: &reqwest::Client, base: &str) -> AppResult<nex_domain::api::ProTeamsDto> {
    get_json(http, base, &["v1", "pro", "teams"], &[], Duration::from_secs(40)).await
}

pub async fn match_one(http: &reqwest::Client, base: &str, platform: &str, match_id: &str) -> AppResult<MatchDto> {
    get_json(http, base, &["v1", "match", platform, match_id], &[], Duration::from_secs(20)).await
}

/// Parametres de perimetre des statistiques, deja valides par la commande appelante.
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StatsParams {
    pub patch: Option<String>,
    pub platform: Option<String>,
    pub queue: Option<u32>,
    pub tier: Option<String>,
    pub position: Option<String>,
}

impl StatsParams {
    /// Validation stricte : valeurs connues uniquement (le backend revalide).
    pub fn validate(&self) -> AppResult<()> {
        if let Some(p) = &self.patch {
            let ok = p == "all" || p.is_empty() || {
                let parts: Vec<&str> = p.split('.').collect();
                parts.len() == 2 && parts.iter().all(|x| !x.is_empty() && x.len() <= 3 && x.bytes().all(|b| b.is_ascii_digit()))
            };
            if !ok {
                return Err(AppError::InvalidInput("patch invalide".into()));
            }
        }
        if let Some(p) = &self.platform {
            if p != "all" {
                nex_domain::riot::Platform::parse(p)?;
            }
        }
        if let Some(q) = self.queue {
            if q != 420 && q != 440 {
                return Err(AppError::InvalidInput("file non prise en charge".into()));
            }
        }
        if let Some(t) = &self.tier {
            if !["all", "CHALLENGER", "GRANDMASTER", "MASTER"].contains(&t.as_str()) {
                return Err(AppError::InvalidInput("rang inconnu".into()));
            }
        }
        if let Some(p) = &self.position {
            if !["", "ALL", "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].contains(&p.as_str()) {
                return Err(AppError::InvalidInput("poste inconnu".into()));
            }
        }
        Ok(())
    }

    fn query(&self) -> Vec<(&'static str, String)> {
        let mut q = Vec::new();
        if let Some(v) = &self.patch {
            q.push(("patch", v.clone()));
        }
        if let Some(v) = &self.platform {
            q.push(("platform", v.clone()));
        }
        if let Some(v) = self.queue {
            q.push(("queue", v.to_string()));
        }
        if let Some(v) = &self.tier {
            q.push(("tier", v.clone()));
        }
        if let Some(v) = &self.position {
            q.push(("position", v.clone()));
        }
        q
    }
}

pub async fn stats_meta(http: &reqwest::Client, base: &str) -> AppResult<nex_domain::api::StatsMetaDto> {
    get_json(http, base, &["v1", "stats", "meta"], &[], Duration::from_secs(10)).await
}

pub async fn stats_tierlist(http: &reqwest::Client, base: &str, p: &StatsParams) -> AppResult<nex_domain::api::TierListDto> {
    get_json(http, base, &["v1", "stats", "tierlist"], &p.query(), Duration::from_secs(15)).await
}

pub async fn stats_baselines(http: &reqwest::Client, base: &str, p: &StatsParams) -> AppResult<nex_domain::api::BaselinesDto> {
    get_json(http, base, &["v1", "stats", "baselines"], &p.query(), Duration::from_secs(20)).await
}

pub async fn stats_icons(http: &reqwest::Client, base: &str, p: &StatsParams) -> AppResult<nex_domain::api::IconsDto> {
    get_json(http, base, &["v1", "stats", "icons"], &p.query(), Duration::from_secs(20)).await
}

pub async fn stats_build(http: &reqwest::Client, base: &str, champion: i32, p: &StatsParams) -> AppResult<nex_domain::api::ChampionBuildDto> {
    let id = champion.to_string();
    get_json(http, base, &["v1", "stats", "champion", &id, "build"], &p.query(), Duration::from_secs(15)).await
}

pub async fn stats_matchups(http: &reqwest::Client, base: &str, champion: i32, p: &StatsParams) -> AppResult<nex_domain::api::MatchupsDto> {
    let id = champion.to_string();
    get_json(http, base, &["v1", "stats", "champion", &id, "matchups"], &p.query(), Duration::from_secs(15)).await
}

pub async fn leaderboard(http: &reqwest::Client, base: &str, platform: &str, queue: &str, tier: &str, page: u32) -> AppResult<nex_domain::api::LeaderboardDto> {
    let q = vec![("queue", queue.to_string()), ("tier", tier.to_string()), ("page", page.to_string())];
    get_json(http, base, &["v1", "leaderboard", platform], &q, Duration::from_secs(45)).await
}

/// Releves de rang deja enregistres par le backend. Aucune requete Riot derriere.
pub async fn rank_history(http: &reqwest::Client, base: &str, platform: &str, puuid: &str, queue: &str) -> AppResult<Vec<nex_domain::api::RankSnapshotDto>> {
    let q = vec![("queue", queue.to_string())];
    get_json(http, base, &["v1", "ranks", platform, puuid], &q, Duration::from_secs(15)).await
}

pub async fn live_game(http: &reqwest::Client, base: &str, platform: &str, puuid: &str) -> AppResult<nex_domain::api::LiveGameDto> {
    get_json(http, base, &["v1", "live", platform, puuid], &[], Duration::from_secs(15)).await
}

/// Timeline : immuable, donc conservee dans le cache local (30 jours) apres le premier chargement.
pub async fn timeline(db: &Db, http: &reqwest::Client, base: &str, platform: &str, match_id: &str) -> AppResult<TimelineDto> {
    let key = format!("timeline:v1:{match_id}");
    if let Some(entry) = db.with(|c| cache::get(c, &key))? {
        if let Ok(t) = serde_json::from_str::<TimelineDto>(&entry.body) {
            return Ok(t);
        }
    }
    let t: TimelineDto = get_json(http, base, &["v1", "match", platform, match_id, "timeline"], &[], Duration::from_secs(30)).await?;
    if let Ok(body) = serde_json::to_string(&t) {
        db.with(|c| cache::put(c, &key, &body, 30 * 24 * 3600))?;
    }
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_building_encodes_segments() {
        let u = build_url("http://127.0.0.1:8787", &["v1", "players", "EUW1", "Élo die", "EUW"], &[("refresh", "true".into())]).unwrap();
        assert_eq!(u.as_str(), "http://127.0.0.1:8787/v1/players/EUW1/%C3%89lo%20die/EUW?refresh=true");
        let u = build_url("https://api.example/base", &["v1", "health"], &[]).unwrap();
        assert_eq!(u.as_str(), "https://api.example/base/v1/health");
    }

    #[test]
    fn maps_backend_errors() {
        let e = map_api_error(reqwest::StatusCode::TOO_MANY_REQUESTS, r#"{"code":"rate_limited","message":"x","retryAfterSecs":7}"#);
        assert!(matches!(e, AppError::RateLimited { retry_after_secs: 7 }));
        let e = map_api_error(reqwest::StatusCode::NOT_FOUND, r#"{"code":"not_found","message":"Riot ID introuvable"}"#);
        assert_eq!(e.code(), "not_found");
        let e = map_api_error(reqwest::StatusCode::BAD_GATEWAY, "<html>");
        assert_eq!(e.code(), "unavailable");
    }
}
