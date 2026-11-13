//! Classification des objets (Data Dragon) pour les builds : objet termine, bottes, consommables.

use crate::error::{BResult, BackendError};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Default, Clone)]
pub struct ItemClasses {
    pub completed: HashSet<u32>,
    pub boots: HashSet<u32>,
}

#[derive(Deserialize)]
struct DdItems {
    data: HashMap<String, DdItem>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DdItem {
    gold: DdGold,
    into: Vec<String>,
    tags: Vec<String>,
    maps: HashMap<String, bool>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DdGold {
    total: u32,
}

/// Termine = disponible sur la Faille (map 11), >= 2200 PO, sans amelioration standard,
/// ni consommable ni trinket. Bottes = tag Boots, >= 900 PO (rang 2 ou plus).
pub fn classify(item_json: &str) -> BResult<ItemClasses> {
    let items: DdItems = serde_json::from_str(item_json)?;
    let mut out = ItemClasses::default();
    for (id, it) in items.data {
        let Ok(id) = id.parse::<u32>() else { continue };
        if !it.maps.get("11").copied().unwrap_or(false) {
            continue;
        }
        let tag = |t: &str| it.tags.iter().any(|x| x == t);
        if tag("Consumable") || tag("Trinket") {
            continue;
        }
        if tag("Boots") {
            // Bottes de rang 2 et plus (les bottes de rang 2 ont desormais une amelioration de rang 3).
            if it.gold.total >= 900 {
                out.boots.insert(id);
            }
        } else if it.gold.total >= 2200 && it.into.is_empty() {
            out.completed.insert(id);
        }
    }
    if out.completed.is_empty() {
        return Err(BackendError::Upstream("classification des objets vide".into()));
    }
    Ok(out)
}

pub async fn fetch(http: &reqwest::Client) -> BResult<ItemClasses> {
    let err = |e: reqwest::Error| BackendError::Upstream(format!("Data Dragon : {e}"));
    let versions: Vec<String> = http
        .get("https://ddragon.leagueoflegends.com/api/versions.json")
        .send()
        .await
        .map_err(err)?
        .json()
        .await
        .map_err(err)?;
    let v = versions.first().ok_or_else(|| BackendError::Upstream("aucune version Data Dragon".into()))?;
    if !v.split('.').all(|p| p.chars().all(|c| c.is_ascii_digit())) {
        return Err(BackendError::Upstream("version Data Dragon inattendue".into()));
    }
    let body = http
        .get(format!("https://ddragon.leagueoflegends.com/cdn/{v}/data/en_US/item.json"))
        .send()
        .await
        .map_err(err)?
        .text()
        .await
        .map_err(err)?;
    classify(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies() {
        let c = classify(
            r#"{"data":{
              "3089":{"gold":{"total":3600},"into":[],"tags":["SpellDamage"],"maps":{"11":true}},
              "1058":{"gold":{"total":1200},"into":["3089"],"tags":[],"maps":{"11":true}},
              "3020":{"gold":{"total":1100},"into":["3170"],"tags":["Boots"],"maps":{"11":true}},
              "1001":{"gold":{"total":300},"into":["3020"],"tags":["Boots"],"maps":{"11":true}},
              "2003":{"gold":{"total":50},"into":[],"tags":["Consumable"],"maps":{"11":true}},
              "9999":{"gold":{"total":3000},"into":[],"tags":[],"maps":{"11":false}}
            }}"#,
        )
        .unwrap();
        assert!(c.completed.contains(&3089));
        assert!(!c.completed.contains(&1058));
        assert!(!c.completed.contains(&9999));
        assert!(c.boots.contains(&3020));
        assert!(!c.boots.contains(&1001));
    }
}
