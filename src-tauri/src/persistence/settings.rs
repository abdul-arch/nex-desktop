//! Preferences utilisateur : liste fermee de cles, chaque valeur validee en Rust.

use super::now_secs;
use nex_domain::riot::Platform;
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// "fr" | "en"
    pub language: String,
    /// "AZER" | "QWER" : libelles des competences.
    pub ability_keys: String,
    /// "tray" | "quit"
    pub close_behavior: String,
    /// Mode Eco : capture et buffer de replay arretes.
    pub eco_mode: bool,
    pub sidebar_collapsed: bool,
    /// Mode demonstration : donnees fictives, toujours signale dans l'interface.
    pub demo_mode: bool,
    pub default_platform: String,
    /// URL de base du backend NEX (https, ou http uniquement en boucle locale).
    pub backend_url: String,
    /// Compte lie ("Pseudo#TAG", vide si aucun) : alimente le dashboard reel.
    pub linked_riot_id: String,
    pub linked_platform: String,
    /// Champions favoris (identifiants numeriques Riot).
    pub favorite_champions: Vec<i32>,
    /// Ouvrir l'overlay automatiquement au debut d'une partie.
    pub overlay_auto: bool,
    /// Tampon de replay : duree (s) et taille maximale (Mio).
    pub replay_seconds: u32,
    pub replay_max_mib: u32,
    /// Enregistrer les parties completes (sinon seulement le tampon de replay et les clips).
    pub record_full_games: bool,
    /// Clips automatiques (multikills, aces, vols d'objectifs).
    pub auto_clips: bool,
    /// Quota du dossier d'enregistrements (Gio).
    pub storage_quota_gib: u32,
    /// Skins favoris (identifiants de skin).
    pub favorite_skins: Vec<u32>,
    /// ARAM Mayhem : lecture des cartes apres une montee de niveau (jamais en mode Eco).
    pub mayhem_auto: bool,
    /// ARAM Mayhem : afficher les badges sur les cartes.
    pub mayhem_badges: bool,
    /// Orientation de jeu : "" | "degats" | "resistance" | "soutien" | "mobilite".
    pub mayhem_orientation: String,
    /// Position verticale du badge sous le titre, en dixiemes de hauteur de titre.
    pub mayhem_badge_offset: u32,
    /// Taille (%) et opacite (%) des badges.
    pub mayhem_badge_scale: u32,
    pub mayhem_badge_opacity: u32,
}

pub const DEFAULT_BACKEND_URL: &str = "http://127.0.0.1:8787";

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "fr".into(),
            ability_keys: "AZER".into(),
            close_behavior: "quit".into(),
            eco_mode: true,
            sidebar_collapsed: false,
            demo_mode: true,
            default_platform: "EUW1".into(),
            backend_url: DEFAULT_BACKEND_URL.into(),
            linked_riot_id: String::new(),
            linked_platform: "EUW1".into(),
            favorite_champions: Vec::new(),
            overlay_auto: true,
            replay_seconds: 120,
            replay_max_mib: 512,
            record_full_games: false,
            auto_clips: true,
            storage_quota_gib: 20,
            favorite_skins: Vec::new(),
            mayhem_auto: true,
            mayhem_badges: true,
            mayhem_orientation: String::new(),
            mayhem_badge_offset: 118,
            mayhem_badge_scale: 100,
            mayhem_badge_opacity: 95,
        }
    }
}

/// HTTPS obligatoire, sauf pour un backend local (127.0.0.1, ::1, localhost).
/// Ni identifiants, ni requete, ni fragment. Renvoie l'URL normalisee sans "/" final.
pub fn validate_backend_url(raw: &str) -> AppResult<String> {
    let raw = raw.trim();
    if raw.len() > 200 {
        return Err(AppError::InvalidInput("URL du backend trop longue".into()));
    }
    let url = reqwest::Url::parse(raw).map_err(|_| AppError::InvalidInput("URL du backend invalide".into()))?;
    let host = url.host_str().unwrap_or_default();
    let loopback = matches!(host, "127.0.0.1" | "[::1]" | "localhost");
    let scheme_ok = url.scheme() == "https" || (url.scheme() == "http" && loopback);
    if !scheme_ok {
        return Err(AppError::InvalidInput(
            "HTTPS obligatoire pour un backend distant (HTTP accepte seulement en local)".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::InvalidInput("l'URL du backend ne doit contenir ni identifiants ni parametres".into()));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn one_of(value: &Value, allowed: &[&str], key: &str) -> AppResult<String> {
    match value.as_str() {
        Some(s) if allowed.contains(&s) => Ok(s.to_string()),
        _ => Err(AppError::InvalidInput(format!(
            "valeur invalide pour {key} (attendu : {})",
            allowed.join(", ")
        ))),
    }
}

fn ranged(value: &Value, key: &str, min: u64, max: u64) -> AppResult<u32> {
    value
        .as_u64()
        .filter(|v| (min..=max).contains(v))
        .map(|v| v as u32)
        .ok_or_else(|| AppError::InvalidInput(format!("{key} doit être compris entre {min} et {max}")))
}

fn boolean(value: &Value, key: &str) -> AppResult<bool> {
    value
        .as_bool()
        .ok_or_else(|| AppError::InvalidInput(format!("{key} attend un booleen")))
}

/// Applique une modification validee a une copie des preferences.
pub fn apply(mut s: Settings, key: &str, value: &Value) -> AppResult<Settings> {
    match key {
        "language" => s.language = one_of(value, &["fr", "en"], key)?,
        "abilityKeys" => s.ability_keys = one_of(value, &["AZER", "QWER"], key)?,
        "closeBehavior" => s.close_behavior = one_of(value, &["tray", "quit"], key)?,
        "ecoMode" => s.eco_mode = boolean(value, key)?,
        "sidebarCollapsed" => s.sidebar_collapsed = boolean(value, key)?,
        "demoMode" => s.demo_mode = boolean(value, key)?,
        "overlayAuto" => s.overlay_auto = boolean(value, key)?,
        "recordFullGames" => s.record_full_games = boolean(value, key)?,
        "autoClips" => s.auto_clips = boolean(value, key)?,
        "replaySeconds" => s.replay_seconds = ranged(value, key, 30, 600)?,
        "replayMaxMib" => s.replay_max_mib = ranged(value, key, 128, 4096)?,
        "storageQuotaGib" => s.storage_quota_gib = ranged(value, key, 1, 1000)?,
        "mayhemAuto" => s.mayhem_auto = boolean(value, key)?,
        "mayhemBadges" => s.mayhem_badges = boolean(value, key)?,
        "mayhemOrientation" => s.mayhem_orientation = one_of(value, &["", "degats", "resistance", "soutien", "mobilite"], key)?,
        "mayhemBadgeOffset" => s.mayhem_badge_offset = ranged(value, key, 40, 200)?,
        "mayhemBadgeScale" => s.mayhem_badge_scale = ranged(value, key, 50, 200)?,
        "mayhemBadgeOpacity" => s.mayhem_badge_opacity = ranged(value, key, 30, 100)?,
        "defaultPlatform" => {
            let code = value
                .as_str()
                .ok_or_else(|| AppError::InvalidInput("region attendue".into()))?;
            s.default_platform = Platform::parse(code)?.code().to_string();
        }
        "backendUrl" => {
            let raw = value.as_str().ok_or_else(|| AppError::InvalidInput("URL attendue".into()))?;
            s.backend_url = validate_backend_url(raw)?;
        }
        "linkedRiotId" => {
            let raw = value.as_str().ok_or_else(|| AppError::InvalidInput("Riot ID attendu".into()))?;
            s.linked_riot_id = if raw.trim().is_empty() {
                String::new()
            } else {
                let id = nex_domain::riot::RiotId::parse(raw)?;
                format!("{}#{}", id.game_name, id.tag_line)
            };
        }
        "favoriteChampions" => {
            let arr = value.as_array().ok_or_else(|| AppError::InvalidInput("liste attendue".into()))?;
            if arr.len() > 200 {
                return Err(AppError::InvalidInput("200 champions favoris au maximum".into()));
            }
            let mut ids: Vec<i32> = Vec::with_capacity(arr.len());
            for v in arr {
                let id = v
                    .as_i64()
                    .filter(|i| (1..=10_000).contains(i))
                    .ok_or_else(|| AppError::InvalidInput("identifiant de champion invalide".into()))? as i32;
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
            s.favorite_champions = ids;
        }
        "favoriteSkins" => {
            let arr = value.as_array().ok_or_else(|| AppError::InvalidInput("liste attendue".into()))?;
            if arr.len() > 1000 {
                return Err(AppError::InvalidInput("1000 skins favoris au maximum".into()));
            }
            let mut ids: Vec<u32> = Vec::with_capacity(arr.len());
            for v in arr {
                let id = v
                    .as_u64()
                    .filter(|i| (1000..=10_000_999).contains(i))
                    .ok_or_else(|| AppError::InvalidInput("identifiant de skin invalide".into()))? as u32;
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
            s.favorite_skins = ids;
        }
        "linkedPlatform" => {
            let code = value.as_str().ok_or_else(|| AppError::InvalidInput("region attendue".into()))?;
            s.linked_platform = Platform::parse(code)?.code().to_string();
        }
        _ => return Err(AppError::InvalidInput(format!("reglage inconnu : {key}"))),
    }
    Ok(s)
}

pub fn load(conn: &Connection) -> AppResult<Settings> {
    let mut stmt = conn.prepare_cached("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut s = Settings::default();
    for row in rows {
        let (key, raw) = row?;
        // Une valeur ancienne ou corrompue est ignoree : on garde la valeur par defaut.
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            if let Ok(next) = apply(s.clone(), &key, &value) {
                s = next;
            }
        }
    }
    Ok(s)
}

pub fn set(conn: &Connection, key: &str, value: &Value) -> AppResult<Settings> {
    let next = apply(load(conn)?, key, value)?;
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value.to_string(), now_secs()],
    )?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;
    use serde_json::json;

    #[test]
    fn set_and_reload() {
        let db = Db::open_in_memory().unwrap();
        db.with(|c| set(c, "abilityKeys", &json!("QWER"))).unwrap();
        db.with(|c| set(c, "defaultPlatform", &json!("kr"))).unwrap();
        let s = db.with(load).unwrap();
        assert_eq!(s.ability_keys, "QWER");
        assert_eq!(s.default_platform, "KR");
    }

    #[test]
    fn backend_url_rules() {
        assert_eq!(validate_backend_url("http://127.0.0.1:8787/").unwrap(), "http://127.0.0.1:8787");
        assert!(validate_backend_url("https://api.nex.example/base").is_ok());
        assert!(validate_backend_url("http://api.nex.example").is_err());
        assert!(validate_backend_url("https://user:pw@api.nex.example").is_err());
        assert!(validate_backend_url("https://api.nex.example/?x=1").is_err());
        assert!(validate_backend_url("file:///C:/x").is_err());
    }

    #[test]
    fn favorite_champions() {
        let db = Db::open_in_memory().unwrap();
        let s = db.with(|c| set(c, "favoriteChampions", &json!([103, 103, 238]))).unwrap();
        assert_eq!(s.favorite_champions, vec![103, 238]);
        assert!(db.with(|c| set(c, "favoriteChampions", &json!([0]))).is_err());
        assert!(db.with(|c| set(c, "favoriteChampions", &json!("103"))).is_err());
        assert_eq!(db.with(load).unwrap().favorite_champions, vec![103, 238]);
    }

    #[test]
    fn linked_account() {
        let db = Db::open_in_memory().unwrap();
        let s = db.with(|c| set(c, "linkedRiotId", &json!(" Player One#EUW "))).unwrap();
        assert_eq!(s.linked_riot_id, "Player One#EUW");
        let s = db.with(|c| set(c, "linkedRiotId", &json!(""))).unwrap();
        assert_eq!(s.linked_riot_id, "");
        assert!(db.with(|c| set(c, "linkedRiotId", &json!("nope"))).is_err());
    }

    #[test]
    fn rejects_unknown_key_and_bad_value() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.with(|c| set(c, "shell", &json!("cmd"))).is_err());
        assert!(db.with(|c| set(c, "ecoMode", &json!("yes"))).is_err());
        assert!(db.with(|c| set(c, "language", &json!("de"))).is_err());
    }
}
