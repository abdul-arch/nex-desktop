use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Clone)]
pub struct Config {
    /// Cle Riot. Jamais journalisee, jamais renvoyee par l'API.
    pub riot_api_key: Option<String>,
    pub bind: SocketAddr,
    pub db_path: PathBuf,
    pub max_concurrency: usize,
    /// Limites applicatives : (nombre, fenetre en secondes). Cle de dev Riot : 20/1 s et 100/120 s.
    pub app_limits: Vec<(u32, u64)>,
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("riot_api_key", &self.riot_api_key.as_ref().map(|_| "<definie>"))
            .field("bind", &self.bind)
            .field("db_path", &self.db_path)
            .field("max_concurrency", &self.max_concurrency)
            .field("app_limits", &self.app_limits)
            .finish()
    }
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Format "20:1,100:120" (requetes:secondes).
pub fn parse_limits(raw: &str) -> Result<Vec<(u32, u64)>, String> {
    raw.split(',')
        .map(|part| {
            let (n, s) = part.trim().split_once(':').ok_or("format attendu n:secondes")?;
            let n: u32 = n.parse().map_err(|_| "nombre invalide")?;
            let s: u64 = s.parse().map_err(|_| "fenetre invalide")?;
            if n == 0 || s == 0 {
                return Err("valeurs nulles interdites".to_string());
            }
            Ok((n, s))
        })
        .collect()
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let riot_api_key = env("RIOT_API_KEY");
        if let Some(k) = &riot_api_key {
            if !k.starts_with("RGAPI-") || k.len() > 100 || k.chars().any(|c| c.is_whitespace()) {
                return Err("RIOT_API_KEY ne ressemble pas a une cle Riot (RGAPI-...)".into());
            }
        }
        let bind = env("NEX_BACKEND_BIND")
            .unwrap_or_else(|| "127.0.0.1:8787".into())
            .parse()
            .map_err(|_| "NEX_BACKEND_BIND invalide")?;
        let db_path = env("NEX_BACKEND_DB").map(PathBuf::from).unwrap_or_else(|| {
            if std::path::Path::new("backend").is_dir() {
                PathBuf::from("backend/nex-backend.sqlite3")
            } else {
                PathBuf::from("nex-backend.sqlite3")
            }
        });
        let max_concurrency = env("RIOT_MAX_CONCURRENCY")
            .map(|v| v.parse::<usize>().map_err(|_| "RIOT_MAX_CONCURRENCY invalide"))
            .transpose()?
            .unwrap_or(4)
            .clamp(1, 32);
        let app_limits = parse_limits(&env("RIOT_APP_LIMITS").unwrap_or_else(|| "20:1,100:120".into()))?;
        Ok(Self { riot_api_key, bind, db_path, max_concurrency, app_limits })
    }
}

/// Collecteur : NEX_COLLECTOR=on, NEX_COLLECTOR_PLATFORMS=EUW1,KR, NEX_COLLECTOR_PACE_MS=2500,
/// NEX_COLLECTOR_TIMELINES=true, NEX_COLLECTOR_PLAYERS=100 (par ligue).
pub fn collector_from_env() -> Result<crate::collector::CollectorConfig, String> {
    let enabled = matches!(env("NEX_COLLECTOR").as_deref(), Some("on" | "true" | "1"));
    let platforms = env("NEX_COLLECTOR_PLATFORMS")
        .unwrap_or_else(|| "EUW1".into())
        .split(',')
        .map(|p| nex_domain::riot::Platform::parse(p).map_err(|e| e.0))
        .collect::<Result<Vec<_>, _>>()?;
    let pace_ms: u64 = env("NEX_COLLECTOR_PACE_MS").map(|v| v.parse().map_err(|_| "NEX_COLLECTOR_PACE_MS invalide")).transpose()?.unwrap_or(2500);
    let players: usize = env("NEX_COLLECTOR_PLAYERS").map(|v| v.parse().map_err(|_| "NEX_COLLECTOR_PLAYERS invalide")).transpose()?.unwrap_or(100);
    Ok(crate::collector::CollectorConfig {
        enabled,
        platforms,
        // Plancher a 1,2 s : le collecteur ne doit jamais consommer tout le quota.
        pace: std::time::Duration::from_millis(pace_ms.max(1200)),
        timelines: !matches!(env("NEX_COLLECTOR_TIMELINES").as_deref(), Some("off" | "false" | "0")),
        players_per_tier: players.clamp(1, 1000),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits() {
        assert_eq!(parse_limits("20:1,100:120").unwrap(), vec![(20, 1), (100, 120)]);
        assert!(parse_limits("20").is_err());
        assert!(parse_limits("0:1").is_err());
    }

    #[test]
    fn debug_hides_key() {
        let c = Config {
            riot_api_key: Some("RGAPI-secret".into()),
            bind: "127.0.0.1:1".parse().unwrap(),
            db_path: "x".into(),
            max_concurrency: 1,
            app_limits: vec![],
        };
        assert!(!format!("{c:?}").contains("secret"));
    }
}
