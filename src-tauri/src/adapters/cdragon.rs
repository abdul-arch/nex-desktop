//! Catalogue des skins (CommunityDragon : miroir des donnees du client) : nom, rarete, series,
//! statut « Legacy ». Aucun prix RP n'est fourni par cette source.

use crate::error::{AppError, AppResult};
use crate::persistence::{Db, cache};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const BASE: &str = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkinEntry {
    pub id: u32,
    pub champion_id: i32,
    /// Numero du skin pour ce champion (illustrations Data Dragon : <Cle>_<num>.jpg).
    pub num: u32,
    pub name: String,
    /// standard | rare | epic | legendary | mythic | ultimate | exalted | transcendent
    pub rarity: String,
    pub legacy: bool,
    pub lines: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkinCatalog {
    pub fetched_at: i64,
    pub skins: Vec<SkinEntry>,
    /// Series (skin lines) : identifiant -> nom.
    pub lines: HashMap<u32, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RSkin {
    id: u32,
    #[serde(default)]
    name: String,
    #[serde(default)]
    is_base: bool,
    #[serde(default)]
    rarity: String,
    #[serde(default)]
    is_legacy: bool,
    #[serde(default)]
    skin_lines: Option<Vec<RLineRef>>,
}

#[derive(Deserialize)]
struct RLineRef {
    id: u32,
}

#[derive(Deserialize)]
struct RLine {
    id: u32,
    #[serde(default)]
    name: String,
}

pub fn rarity_of(raw: &str) -> &'static str {
    match raw {
        "kRare" => "rare",
        "kEpic" => "epic",
        "kLegendary" => "legendary",
        "kMythic" => "mythic",
        "kUltimate" => "ultimate",
        "kExalted" => "exalted",
        "kTranscendent" => "transcendent",
        _ => "standard",
    }
}

pub fn build(skins_json: &str, lines_json: &str, now: i64) -> AppResult<SkinCatalog> {
    let raw: HashMap<String, RSkin> = serde_json::from_str(skins_json)?;
    let lines: Vec<RLine> = serde_json::from_str(lines_json)?;
    let mut skins: Vec<SkinEntry> = raw
        .into_values()
        // Skins de champions League uniquement : id = champion * 1000 + numero, champion < 1000.
        // Le fichier liste aussi des personnages d'autres projets Riot (ids 60 000 000+, « Jade_* »).
        .filter(|s| !s.is_base && (1000..1_000_000).contains(&s.id) && s.id % 1000 != 0)
        .map(|s| SkinEntry {
            id: s.id,
            champion_id: (s.id / 1000) as i32,
            num: s.id % 1000,
            name: s.name.chars().filter(|c| !c.is_control()).take(80).collect(),
            rarity: rarity_of(&s.rarity).into(),
            legacy: s.is_legacy,
            lines: s.skin_lines.unwrap_or_default().into_iter().map(|l| l.id).collect(),
        })
        .collect();
    skins.sort_by_key(|s| s.id);
    if skins.is_empty() {
        return Err(AppError::Unavailable("catalogue de skins vide".into()));
    }
    Ok(SkinCatalog {
        fetched_at: now,
        skins,
        lines: lines.into_iter().filter(|l| l.id > 0 && !l.name.is_empty()).map(|l| (l.id, l.name)).collect(),
    })
}

pub async fn catalog(db: &Db, http: &reqwest::Client, lang: &str) -> AppResult<SkinCatalog> {
    let lang = if lang == "en" { "default" } else { "fr_fr" };
    let key = format!("cdragon:skins:v2:{lang}");
    if let Some(e) = db.with(|c| cache::get(c, &key))? {
        if e.fresh {
            if let Ok(c) = serde_json::from_str::<SkinCatalog>(&e.body) {
                return Ok(c);
            }
        }
    }
    let get = |file: &'static str| {
        let url = format!("{BASE}/{lang}/v1/{file}");
        async move {
            let r = http.get(url).timeout(std::time::Duration::from_secs(30)).send().await?.error_for_status()?;
            Ok::<String, AppError>(r.text().await?)
        }
    };
    let (skins, lines) = tokio::join!(get("skins.json"), get("skinlines.json"));
    match (skins, lines) {
        (Ok(s), Ok(l)) => {
            let cat = build(&s, &l, crate::persistence::now_secs() * 1000)?;
            db.with(|c| cache::put(c, &key, &serde_json::to_string(&cat)?, 7 * 24 * 3600))?;
            Ok(cat)
        }
        (Err(e), _) | (_, Err(e)) => {
            // Hors ligne : derniere version connue, meme expiree.
            if let Some(entry) = db.with(|c| cache::get(c, &key))? {
                if let Ok(c) = serde_json::from_str::<SkinCatalog>(&entry.body) {
                    return Ok(c);
                }
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_catalog_without_base_skins() {
        let skins = r#"{
          "103000": {"id": 103000, "name": "Ahri", "isBase": true, "rarity": "kNoRarity"},
          "103027": {"id": 103027, "name": "Ahri fleur spirituelle", "isBase": false, "rarity": "kEpic", "isLegacy": false, "skinLines": [{"id": 120}]},
          "103086": {"id": 103086, "name": "Ahri immortalisée", "isBase": false, "rarity": "kMythic", "isLegacy": true, "skinLines": null},
          "60103301": {"id": 60103301, "name": "Ahri classic", "isBase": false, "rarity": "kNoRarity"}
        }"#;
        let lines = r#"[{"id": 0, "name": ""}, {"id": 120, "name": "Fleur spirituelle"}]"#;
        let c = build(skins, lines, 1).unwrap();
        assert_eq!(c.skins.len(), 2);
        assert_eq!(c.skins[0].num, 27);
        assert_eq!(c.skins[0].champion_id, 103);
        assert_eq!(c.skins[0].rarity, "epic");
        assert!(c.skins[1].legacy);
        assert_eq!(c.lines[&120], "Fleur spirituelle");
        assert!(!c.lines.contains_key(&0));
    }
}
