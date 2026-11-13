//! Inventaire des skins depuis le client local (lecture seule), avec date d'acquisition.
//! Sans client, le dernier releve est servi avec sa date ; sans releve, l'inventaire est inconnu.

use crate::adapters::lcu::{Lcu, paths};
use crate::error::AppResult;
use crate::persistence::{Db, cache};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const CACHE_KEY: &str = "inventory:skins:v2";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnedSkin {
    pub id: u32,
    /// Date d'acquisition (ms) si le client la fournit.
    pub acquired_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkinInventory {
    /// client (releve a l'instant) | cache (dernier releve) | unknown
    pub source: String,
    pub fetched_at: Option<i64>,
    pub owned: Vec<OwnedSkin>,
    /// Skins que le client signale comme n'etant plus obtenables.
    pub unobtainable: Vec<u32>,
    pub obtainable_known: bool,
}

/// Jours depuis 1970-01-01 pour une date civile (algorithme de H. Hinnant).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// "20231105T123456.000Z" -> millisecondes UTC.
pub fn parse_purchase_date(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 15 || b[8] != b'T' {
        return None;
    }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(4, 6)?, n(6, 8)?, n(9, 11)?, n(11, 13)?, n(13, 15)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 || y < 2009 {
        return None;
    }
    Some(((days_from_civil(y, mo, d) * 24 + h) * 60 + mi) * 60_000 + se * 1000)
}

pub fn owned_from_inventory(items: &[Value]) -> Vec<OwnedSkin> {
    let mut out: Vec<OwnedSkin> = items
        .iter()
        .filter(|i| i.get("owned").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|i| {
            let id = i.get("itemId").and_then(Value::as_u64)? as u32;
            Some(OwnedSkin { id, acquired_at: i.get("purchaseDate").and_then(Value::as_str).and_then(parse_purchase_date) })
        })
        .collect();
    out.sort_by_key(|o| o.id);
    out.dedup_by_key(|o| o.id);
    out
}

pub async fn inventory(db: &Db, lcu: Option<Lcu>) -> AppResult<SkinInventory> {
    if let Some(lcu) = lcu {
        if let Ok(items) = lcu.get::<Vec<Value>>(paths::INVENTORY_SKINS).await {
            let owned = owned_from_inventory(&items);
            // Disponibilite en boutique : aucune source fiable. Le champ `stillObtainable` de
            // /lol-champions/.../skins-minimal vaut false meme pour des skins en vente (verifie sur
            // un client reel, 11/2026) : il n'est donc pas utilise. L'interface affiche « inconnue ».
            let inv = SkinInventory {
                source: "client".into(),
                fetched_at: Some(crate::persistence::now_secs() * 1000),
                owned,
                unobtainable: vec![],
                obtainable_known: false,
            };
            db.with(|c| cache::put(c, CACHE_KEY, &serde_json::to_string(&inv)?, 365 * 24 * 3600))?;
            return Ok(inv);
        }
    }
    if let Some(e) = db.with(|c| cache::get(c, CACHE_KEY))? {
        if let Ok(mut inv) = serde_json::from_str::<SkinInventory>(&e.body) {
            inv.source = "cache".into();
            return Ok(inv);
        }
    }
    Ok(SkinInventory { source: "unknown".into(), fetched_at: None, owned: vec![], unobtainable: vec![], obtainable_known: false })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn purchase_dates() {
        // 2023-11-05T12:34:56Z = 1699187696 s
        assert_eq!(parse_purchase_date("20231105T123456.000Z"), Some(1_699_187_696_000));
        assert_eq!(parse_purchase_date("19700101T000000.000Z"), None); // avant 2009 : invalide
        assert_eq!(parse_purchase_date("2023-11-05"), None);
        assert_eq!(parse_purchase_date("20231305T000000.000Z"), None);
    }

    #[test]
    fn owned_items() {
        let items = vec![
            json!({"itemId": 103027, "owned": true, "purchaseDate": "20240101T000000.000Z"}),
            json!({"itemId": 103027, "owned": true}),
            json!({"itemId": 238001, "owned": false}),
            json!({"itemId": 1001, "owned": true, "purchaseDate": "bad"}),
        ];
        let o = owned_from_inventory(&items);
        assert_eq!(o.len(), 2);
        assert_eq!(o[0].id, 1001);
        assert_eq!(o[0].acquired_at, None);
        assert!(o[1].acquired_at.is_some());
    }

    /// Integration (client League ouvert requis) :
    /// `cargo test -p nex -- --ignored inventory_probe --nocapture`. Lecture seule ; n'affiche que des comptes.
    #[tokio::test]
    #[ignore]
    async fn inventory_probe() {
        use crate::adapters::lcu::{find_install_dir, pinned_client, read_credentials};
        use std::time::Duration;
        let dir = find_install_dir(sysinfo::System::new().ok().as_mut()).expect("client League introuvable");
        let creds = read_credentials(&dir).expect("lockfile illisible");
        let lcu = Lcu::new(pinned_client(Duration::from_secs(8)).unwrap(), creds);
        let db = Db::open_in_memory().unwrap();
        let inv = inventory(&db, Some(lcu)).await.unwrap();
        let dated = inv.owned.iter().filter(|o| o.acquired_at.is_some()).count();
        println!("source={} possedes={} dates={}", inv.source, inv.owned.len(), dated);
        assert_eq!(inv.source, "client");
        // Sans client : le releve mis en cache est servi, marque comme tel.
        let cached = inventory(&db, None).await.unwrap();
        assert_eq!(cached.source, "cache");
        assert_eq!(cached.owned.len(), inv.owned.len());
    }
}
