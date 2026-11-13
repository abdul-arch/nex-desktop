//! Donnees de l'assistant Mayhem : catalogue (CommunityDragon), profils de champions et
//! etiquettes d'objets (Data Dragon), regles locales (SQLite). Tout est mis en cache et
//! valide ; aucune regle n'est executee comme du code.

use crate::error::{AppError, AppResult};
use crate::persistence::{Db, cache, now_secs};
use nex_mayhem::rules::{AugmentRule, EDITORIAL_RULES, FIXTURE_RULES, RuleSet};
use nex_mayhem::{ChampionProfile, MayhemCatalog};
use rusqlite::params;
use serde_json::Value;
use std::collections::HashMap;

const CD: &str = "https://raw.communitydragon.org/latest";
const CATALOG_KEY: &str = "mayhem:catalog:v1";

async fn get_json(http: &reqwest::Client, url: &str) -> AppResult<Value> {
    let body = http.get(url).timeout(std::time::Duration::from_secs(30)).send().await?.error_for_status()?.text().await?;
    serde_json::from_str(&body).map_err(|e| AppError::Unavailable(format!("donnees illisibles : {e}")))
}

/// Catalogue ARAM Mayhem du patch courant (cache 3 jours, derniere version servie hors ligne).
pub async fn catalog(db: &Db, http: &reqwest::Client) -> AppResult<MayhemCatalog> {
    if let Some(e) = db.with(|c| cache::get(c, CATALOG_KEY))? {
        if e.fresh {
            if let Ok(c) = serde_json::from_str::<MayhemCatalog>(&e.body) {
                return Ok(c);
            }
        }
    }
    let base = format!("{CD}/plugins/rcp-be-lol-game-data/global");
    let (u_lists, u_en, u_fr, u_meta) = (
        format!("{base}/default/v1/augment-lists.json"),
        format!("{base}/default/v1/cherry-augments.json"),
        format!("{base}/fr_fr/v1/cherry-augments.json"),
        format!("{CD}/content-metadata.json"),
    );
    let fetched = async {
        let (lists, en, fr, meta) = tokio::join!(get_json(http, &u_lists), get_json(http, &u_en), get_json(http, &u_fr), get_json(http, &u_meta));
        let patch = meta.ok().and_then(|m| m.get("version").and_then(Value::as_str).map(|v| v.split('+').next().unwrap_or(v).split('.').take(2).collect::<Vec<_>>().join("."))).unwrap_or_default();
        nex_mayhem::catalog::build("KIWI", &lists?, &en?, &fr?, &patch, now_secs() * 1000).map_err(AppError::Unavailable)
    }
    .await;
    match fetched {
        Ok(cat) => {
            db.with(|c| cache::put(c, CATALOG_KEY, &serde_json::to_string(&cat)?, 3 * 24 * 3600))?;
            Ok(cat)
        }
        Err(e) => match db.with(|c| cache::get(c, CATALOG_KEY))?.and_then(|e| serde_json::from_str::<MayhemCatalog>(&e.body).ok()) {
            Some(c) => Ok(c),
            None => Err(e),
        },
    }
}

/// v2 : export brut (avant correspondance). Les entrees v1, deja reliees, sont ignorees.
const DATASET_KEY: &str = "mayhem:dataset:arammayhem:v2";

/// Donnees publiques d'arammayhem.com (CC BY 4.0) : popularite, combos etiquetes, provenance.
/// Index puis fichiers de la meme publication ; validation complete avant remplacement du
/// cache (cle unique : remplacement atomique) ; en cas d'echec, derniere version valide.
pub async fn dataset(db: &Db, http: &reqwest::Client, catalog: &MayhemCatalog) -> AppResult<nex_mayhem::provider::Dataset> {
    use nex_mayhem::provider::{INDEX_URL, LATEST_BASE, mapped, parse_arammayhem};
    // Le cache garde l'export brut, valide en entier ; la correspondance suit le catalogue courant.
    if let Some(e) = db.with(|c| cache::get(c, DATASET_KEY))? {
        if e.fresh {
            if let Ok(d) = serde_json::from_str(&e.body) {
                return Ok(mapped(&d, catalog));
            }
        }
    }
    let (u_aug, u_champ, u_combo) = (format!("{LATEST_BASE}/augments.json"), format!("{LATEST_BASE}/champions.json"), format!("{LATEST_BASE}/combos.json"));
    let fetched = async {
        let index = get_json(http, INDEX_URL).await?;
        let (a, c, k) = tokio::join!(get_json(http, &u_aug), get_json(http, &u_champ), get_json(http, &u_combo));
        parse_arammayhem(&index, &a?, &c?, &k?, now_secs() * 1000).map_err(AppError::Unavailable)
    }
    .await;
    match fetched {
        // Remplacement atomique : la nouvelle publication n'entre qu'entierement validee.
        Ok(raw) => {
            db.with(|c| cache::put(c, DATASET_KEY, &serde_json::to_string(&raw)?, 12 * 3600))?;
            Ok(mapped(&raw, catalog))
        }
        // Panne ou contenu invalide : derniere version valide, avec sa vraie date de recuperation.
        Err(e) => match db.with(|c| cache::get(c, DATASET_KEY))?.and_then(|e| serde_json::from_str(&e.body).ok()) {
            Some(d) => Ok(mapped(&d, catalog)),
            None => Err(e),
        },
    }
}

/// Profil heuristique d'un champion (cle Data Dragon, ex. `Ezreal`), d'apres sa fiche anglaise.
pub async fn profile(db: &Db, http: &reqwest::Client, version: &str, key: &str) -> AppResult<ChampionProfile> {
    if key.is_empty() || key.len() > 32 || !key.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(AppError::InvalidInput("cle de champion invalide".into()));
    }
    let ck = format!("mayhem:profile:v1:{version}:{key}");
    if let Some(e) = db.with(|c| cache::get(c, &ck))? {
        if let Ok(p) = serde_json::from_str::<ChampionProfile>(&e.body) {
            return Ok(p);
        }
    }
    let v = get_json(http, &format!("https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion/{key}.json")).await?;
    let champ = v.get("data").and_then(|d| d.get(key)).ok_or_else(|| AppError::NotFound(format!("champion inconnu : {key}")))?;
    let p = nex_mayhem::profile::from_data_dragon(champ).ok_or_else(|| AppError::Unavailable("fiche champion incomplete".into()))?;
    db.with(|c| cache::put(c, &ck, &serde_json::to_string(&p)?, 30 * 24 * 3600))?;
    Ok(p)
}

/// Etiquettes Data Dragon des objets (id -> etiquettes), pour les mecaniques apportees.
pub async fn item_tags(db: &Db, http: &reqwest::Client, version: &str) -> AppResult<HashMap<u32, Vec<String>>> {
    let ck = format!("mayhem:itemtags:v1:{version}");
    if let Some(e) = db.with(|c| cache::get(c, &ck))? {
        if let Ok(m) = serde_json::from_str::<HashMap<u32, Vec<String>>>(&e.body) {
            return Ok(m);
        }
    }
    let v = get_json(http, &format!("https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/item.json")).await?;
    let mut out = HashMap::new();
    if let Some(items) = v.get("data").and_then(Value::as_object) {
        for (id, item) in items {
            let Ok(id) = id.parse::<u32>() else { continue };
            let tags: Vec<String> = item.get("tags").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).take(12).map(str::to_string).collect()).unwrap_or_default();
            out.insert(id, tags);
        }
    }
    db.with(|c| cache::put(c, &ck, &serde_json::to_string(&out)?, 30 * 24 * 3600))?;
    Ok(out)
}

/// Regles locales (base editee par le joueur).
pub fn local_rules(db: &Db) -> AppResult<Vec<AugmentRule>> {
    db.with(|c| {
        let mut stmt = c.prepare_cached("SELECT rule FROM mayhem_rules ORDER BY key")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for raw in rows {
            // Une regle devenue invalide (moteur plus recent) est ignoree, pas executee.
            if let Ok(rule) = serde_json::from_str::<AugmentRule>(&raw?) {
                out.push(rule);
            }
        }
        Ok(out)
    })
}

/// Enregistre une regle locale apres validation complete (meme controles qu'un fichier).
pub fn save_local_rule(db: &Db, rule: &AugmentRule) -> AppResult<Vec<AugmentRule>> {
    let mut probe: RuleSet = RuleSet::parse(EDITORIAL_RULES).map_err(AppError::Unavailable)?;
    probe.augments = vec![rule.clone()];
    probe.validate().map_err(AppError::InvalidInput)?;
    let mut r = rule.clone();
    r.validation = None;
    db.with(|c| {
        c.execute(
            "INSERT INTO mayhem_rules (key, rule, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET rule = excluded.rule, updated_at = excluded.updated_at",
            params![r.key, serde_json::to_string(&r)?, now_secs()],
        )?;
        Ok(())
    })?;
    local_rules(db)
}

pub fn delete_local_rule(db: &Db, key: &str) -> AppResult<Vec<AugmentRule>> {
    db.with(|c| {
        c.execute("DELETE FROM mayhem_rules WHERE key = ?1", params![key])?;
        Ok(())
    })?;
    local_rules(db)
}

/// Regles appliquees a une vraie partie : base editoriale + edition locale. Jamais les fixtures.
pub fn production_rules(db: &Db) -> AppResult<RuleSet> {
    let base = RuleSet::parse(EDITORIAL_RULES).map_err(AppError::Unavailable)?;
    Ok(base.with_local(&local_rules(db)?))
}

/// Regles de demonstration (apercu « DEMO » uniquement).
pub fn demo_rules() -> AppResult<RuleSet> {
    RuleSet::parse(FIXTURE_RULES).map_err(AppError::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nex_mayhem::rules::{Tier, Validation};

    fn rule(key: &str) -> AugmentRule {
        serde_json::from_value(serde_json::json!({"key": key, "base": "A", "requires": ["immobilisation"]})).unwrap()
    }

    /// Donnees reelles (reseau) : `cargo test -p nex --lib -- --ignored dataset_probe --nocapture`.
    #[test]
    #[ignore]
    fn dataset_probe() {
        let db = Db::open_in_memory().unwrap();
        let http = reqwest::Client::builder().user_agent("NEX-Desktop/test").build().unwrap();
        tauri::async_runtime::block_on(async {
            let cat = catalog(&db, &http).await.unwrap();
            let ds = dataset(&db, &http, &cat).await.unwrap();
            let p = &ds.provenance;
            println!("provenance: patch {:?} stats {:?} ({:?}) release {:?} licence {} attribution {}", p.patch, p.stats_date, p.stats_date_source, p.release_id, p.license, p.attribution);
            println!("portee: {:?}", p.scope);
            println!("capacites: {:?}", ds.capabilities);
            let count = |m: nex_mayhem::provider::MappingStatus| ds.augments.iter().filter(|a| a.mapping == m).count();
            use nex_mayhem::provider::MappingStatus::*;
            println!(
                "augments source {} | catalogue Riot {} | exact {} alias {} ambigu {} non relie {}",
                ds.augments.len(),
                cat.augments.len(),
                count(Exact),
                count(Alias),
                count(Ambiguous),
                count(Unmapped)
            );
            let unmapped: Vec<String> = ds.augments.iter().filter(|a| a.nex_key.is_none()).map(|a| format!("{} ({})", a.name_en, a.provider_id)).collect();
            println!("non relies : {}", unmapped.join(" | "));
            let mapped: std::collections::BTreeSet<&str> = ds.augments.iter().filter_map(|a| a.nex_key.as_deref()).collect();
            let without_stats: Vec<&str> = cat.augments.iter().filter(|a| !mapped.contains(a.key.as_str())).map(|a| a.name_en.as_str()).collect();
            println!("augments Riot sans donnee source ({}) : {}", without_stats.len(), without_stats.join(" | "));
            println!("champions {} combos {} (dont bug {})", ds.champions.len(), ds.combos.len(), ds.combos.iter().filter(|c| c.needs_verification()).count());
            for a in &ds.anomalies {
                println!("ecart : {a}");
            }
        });
    }

    #[test]
    fn local_rules_feed_production_never_fixtures() {
        let db = Db::open_in_memory().unwrap();
        // Production sans edition locale : aucune regle (aucune note inventee), jamais les fixtures.
        assert!(production_rules(&db).unwrap().augments.is_empty());
        save_local_rule(&db, &rule("ARAM_Firebrand")).unwrap();
        let prod = production_rules(&db).unwrap();
        assert_eq!(prod.augments.len(), 1);
        assert_eq!(prod.augments[0].validation, Some(Validation::LocalEditorial));
        let r = nex_mayhem::rate(&prod, None, &Default::default(), &[Some("ARAM_Firebrand"), Some("StillHere")]);
        assert_eq!(r[0].tier, Some(Tier::A));
        assert_eq!(r[0].validation, Some(Validation::LocalEditorial));
        assert!(r[1].tier.is_none(), "un augment non edite reste non evalue");
        // Regle invalide refusee (cle), suppression.
        assert!(save_local_rule(&db, &rule("bad key")).is_err());
        assert!(delete_local_rule(&db, "ARAM_Firebrand").unwrap().is_empty());
    }
}
