//! Catalogue des augments ARAM Mayhem, construit a partir des fichiers publics du client
//! (CommunityDragon : `augment-lists.json` liste `KIWI` + `cherry-augments.json`).
//! Aucune note ici : le catalogue decrit les augments, les regles les evaluent.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Rarete affichee par le jeu. Independante de la note NEX.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rarity {
    Silver,
    Gold,
    Prismatic,
    /// Choix d'evenement ou rarete inconnue du catalogue.
    Other,
}

impl Rarity {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "kSilver" => Self::Silver,
            "kGold" => Self::Gold,
            "kPrismatic" => Self::Prismatic,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Augment {
    pub id: u32,
    /// Identifiant stable du jeu (`augmentNameId`, ex. `ARAM_ProteinShake`).
    pub key: String,
    pub name_en: String,
    pub name_fr: String,
    pub rarity: Rarity,
    /// Chemin d'icone CommunityDragon (`/lol-game-data/assets/...`), sans hote.
    pub icon: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MayhemCatalog {
    /// Mode du jeu (`KIWI`).
    pub mode: String,
    /// Version du contenu (patch) annoncee par CommunityDragon.
    pub patch: String,
    pub fetched_at: i64,
    pub source: String,
    pub augments: Vec<Augment>,
}

impl MayhemCatalog {
    pub fn get(&self, key: &str) -> Option<&Augment> {
        self.augments.iter().find(|a| a.key == key)
    }
}

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 80 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn valid_icon(p: &str) -> bool {
    p.is_empty() || (p.starts_with("/lol-game-data/assets/") && p.len() <= 300 && !p.contains("..") && p.bytes().all(|b| b.is_ascii_graphic()))
}

/// Construit le catalogue du mode `mode` (ex. `KIWI`).
/// `lists` : `augment-lists.json` ; `en`/`fr` : `cherry-augments.json` anglais et francais.
/// Les entrees invalides sont ignorees ; un catalogue vide est une erreur.
pub fn build(mode: &str, lists: &Value, en: &Value, fr: &Value, patch: &str, fetched_at: i64) -> Result<MayhemCatalog, String> {
    let list = lists
        .as_array()
        .and_then(|a| a.iter().find(|l| l.get("modeName").and_then(Value::as_str) == Some(mode)))
        .and_then(|l| l.get("augmentList"))
        .and_then(Value::as_array)
        .ok_or_else(|| format!("liste d'augments {mode} absente"))?;
    let keys: Vec<String> = list.iter().filter_map(Value::as_str).filter_map(|p| p.rsplit('/').next()).map(str::to_string).collect();
    let by_key = |v: &Value, key: &str| -> Option<Value> {
        v.as_array()?.iter().find(|a| a.get("augmentNameId").and_then(Value::as_str) == Some(key)).cloned()
    };
    let mut augments = Vec::new();
    for key in keys.iter().filter(|k| valid_key(k)) {
        let Some(e) = by_key(en, key) else { continue };
        let f = by_key(fr, key);
        let name_en = clean(e.get("nameTRA").and_then(Value::as_str).unwrap_or(""), 80);
        if name_en.is_empty() {
            continue;
        }
        let name_fr = f.as_ref().and_then(|f| f.get("nameTRA")).and_then(Value::as_str).map(|s| clean(s, 80)).filter(|s| !s.is_empty()).unwrap_or_else(|| name_en.clone());
        let icon = e.get("augmentSmallIconPath").and_then(Value::as_str).unwrap_or("");
        augments.push(Augment {
            id: e.get("id").and_then(Value::as_u64).unwrap_or(0) as u32,
            key: key.clone(),
            name_en,
            name_fr,
            rarity: Rarity::parse(e.get("rarity").and_then(Value::as_str).unwrap_or("")),
            icon: if valid_icon(icon) { icon.to_string() } else { String::new() },
        });
    }
    augments.sort_by(|a, b| a.key.cmp(&b.key));
    augments.dedup_by(|a, b| a.key == b.key);
    if augments.is_empty() {
        return Err(format!("catalogue {mode} vide"));
    }
    Ok(MayhemCatalog { mode: mode.to_string(), patch: clean(patch, 80), fetched_at, source: "CommunityDragon".into(), augments })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_mode_catalog_only() {
        let lists = json!([
            {"modeName": "CHERRY", "augmentList": ["Maps/ModeSpecificData/Augments/ArenaOnly"]},
            {"modeName": "KIWI", "augmentList": ["Maps/ModeSpecificData/Augments/ARAM_ProteinShake", "Maps/ModeSpecificData/Augments/Bad Key", "Maps/ModeSpecificData/Augments/Missing"]}
        ]);
        let en = json!([
            {"id": 1324, "augmentNameId": "ARAM_ProteinShake", "nameTRA": "Protein Shake", "rarity": "kPrismatic", "augmentSmallIconPath": "/lol-game-data/assets/x.png"},
            {"id": 9, "augmentNameId": "ArenaOnly", "nameTRA": "Arena", "rarity": "kGold"}
        ]);
        let fr = json!([{"augmentNameId": "ARAM_ProteinShake", "nameTRA": "Boisson énergisante"}]);
        let c = build("KIWI", &lists, &en, &fr, "16.22", 1).unwrap();
        assert_eq!(c.augments.len(), 1);
        let a = &c.augments[0];
        assert_eq!(a.name_fr, "Boisson énergisante");
        assert_eq!(a.rarity, Rarity::Prismatic);
        assert!(build("NOPE", &lists, &en, &fr, "16.22", 1).is_err());
    }
}
