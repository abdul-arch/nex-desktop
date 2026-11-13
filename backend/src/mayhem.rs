//! Assistant ARAM Mayhem pour la version web : meme moteur que l'application (`nex-mayhem`).
//! Seules les regles editoriales publiees sont appliquees ; l'edition locale reste sur le poste
//! du joueur. Aucune lecture d'ecran ici : catalogue et notes dans un contexte simule.

use crate::error::{BResult, BackendError};
use crate::routes::Shared;
use axum::Json;
use axum::extract::State;
use nex_mayhem::rules::{EDITORIAL_RULES, Orientation, RuleSet};
use nex_mayhem::{ChampionProfile, MayhemCatalog, Rating};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;

const CD: &str = "https://raw.communitydragon.org/latest";
const DAY_MS: i64 = 24 * 3600 * 1000;

fn http() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("NEX-Backend/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("client HTTP")
    })
}

async fn json(url: &str) -> BResult<Value> {
    let r = http().get(url).send().await.map_err(|e| BackendError::Upstream(format!("données statiques : {e}")))?;
    let r = r.error_for_status().map_err(|e| BackendError::Upstream(format!("données statiques : {e}")))?;
    Ok(r.json().await.map_err(|e| BackendError::Upstream(format!("données statiques illisibles : {e}")))?)
}

async fn catalog(s: &Shared) -> BResult<MayhemCatalog> {
    let store = s.riot.store();
    if let Some(c) = store.get("mayhem:catalog:v1")? {
        if c.fresh {
            if let Ok(cat) = serde_json::from_str(&c.body) {
                return Ok(cat);
            }
        }
    }
    let base = format!("{CD}/plugins/rcp-be-lol-game-data/global");
    let (lists, en, fr, meta) = (
        json(&format!("{base}/default/v1/augment-lists.json")).await?,
        json(&format!("{base}/default/v1/cherry-augments.json")).await?,
        json(&format!("{base}/fr_fr/v1/cherry-augments.json")).await?,
        json(&format!("{CD}/content-metadata.json")).await.unwrap_or(Value::Null),
    );
    let patch = meta.get("version").and_then(Value::as_str).map(|v| v.split('+').next().unwrap_or(v).split('.').take(2).collect::<Vec<_>>().join(".")).unwrap_or_default();
    let cat = nex_mayhem::catalog::build("KIWI", &lists, &en, &fr, &patch, crate::store::now_ms()).map_err(BackendError::Upstream)?;
    store.put("mayhem:catalog:v1", &serde_json::to_string(&cat)?, Some(3 * DAY_MS))?;
    Ok(cat)
}

async fn profile(s: &Shared, key: &str) -> BResult<ChampionProfile> {
    if key.is_empty() || key.len() > 32 || !key.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(BackendError::InvalidInput("clé de champion invalide".into()));
    }
    let versions = json("https://ddragon.leagueoflegends.com/api/versions.json").await?;
    let v = versions.get(0).and_then(Value::as_str).ok_or_else(|| BackendError::Upstream("version Data Dragon absente".into()))?.to_string();
    let ck = format!("mayhem:profile:v1:{v}:{key}");
    let store = s.riot.store();
    if let Some(c) = store.get(&ck)? {
        if let Ok(p) = serde_json::from_str(&c.body) {
            return Ok(p);
        }
    }
    let data = json(&format!("https://ddragon.leagueoflegends.com/cdn/{v}/data/en_US/champion/{key}.json")).await?;
    let champ = data.get("data").and_then(|d| d.get(key)).ok_or_else(|| BackendError::NotFound(format!("champion inconnu : {key}")))?;
    let p = nex_mayhem::profile::from_data_dragon(champ).ok_or_else(|| BackendError::Upstream("fiche champion incomplète".into()))?;
    store.put(&ck, &serde_json::to_string(&p)?, Some(30 * DAY_MS))?;
    Ok(p)
}

/// Export public arammayhem.com (CC BY 4.0) : popularite et combos, valide et relie au catalogue.
pub async fn get_dataset(State(s): State<Shared>) -> BResult<Json<nex_mayhem::provider::Dataset>> {
    use nex_mayhem::provider::{INDEX_URL, LATEST_BASE, mapped, parse_arammayhem};
    let store = s.riot.store();
    // v2 : export brut, valide en entier ; la correspondance suit le catalogue courant.
    let key = "mayhem:dataset:arammayhem:v2";
    let cat = catalog(&s).await?;
    if let Some(c) = store.get(key)? {
        if c.fresh {
            if let Ok(d) = serde_json::from_str(&c.body) {
                return Ok(Json(mapped(&d, &cat)));
            }
        }
    }
    let fetched = async {
        let index = json(INDEX_URL).await?;
        let (a, c, k) = (json(&format!("{LATEST_BASE}/augments.json")).await?, json(&format!("{LATEST_BASE}/champions.json")).await?, json(&format!("{LATEST_BASE}/combos.json")).await?);
        parse_arammayhem(&index, &a, &c, &k, crate::store::now_ms()).map_err(BackendError::Upstream)
    }
    .await;
    match fetched {
        Ok(raw) => {
            store.put(key, &serde_json::to_string(&raw)?, Some(12 * 3600 * 1000))?;
            Ok(Json(mapped(&raw, &cat)))
        }
        Err(e) => match store.get(key)?.and_then(|c| serde_json::from_str(&c.body).ok()) {
            Some(d) => Ok(Json(mapped(&d, &cat))),
            None => Err(e),
        },
    }
}

pub async fn get_catalog(State(s): State<Shared>) -> BResult<Json<MayhemCatalog>> {
    Ok(Json(catalog(&s).await?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesInfo {
    editorial: RuleSet,
    local: Vec<()>,
}

pub async fn get_rules() -> BResult<Json<RulesInfo>> {
    Ok(Json(RulesInfo { editorial: RuleSet::parse(EDITORIAL_RULES).map_err(BackendError::Upstream)?, local: vec![] }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateRequest {
    champion: Option<String>,
    offered: Vec<Option<String>>,
    #[serde(default)]
    confirmed: Vec<String>,
    orientation: Option<Orientation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateResult {
    ratings: Vec<Rating>,
    best: Option<usize>,
    profile: Option<ChampionProfile>,
    rules_version: String,
    context: Vec<nex_mayhem::provider::CardContext>,
}

fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 80 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

pub async fn post_rate(State(s): State<Shared>, Json(req): Json<RateRequest>) -> BResult<Json<RateResult>> {
    if req.offered.len() > 400 || req.confirmed.len() > 12 || !req.offered.iter().flatten().chain(&req.confirmed).all(|k| valid_key(k)) {
        return Err(BackendError::InvalidInput("liste d'augments invalide".into()));
    }
    let cat = catalog(&s).await?;
    let profile = match req.champion.as_deref().filter(|c| !c.is_empty()) {
        Some(k) => Some(profile(&s, k).await?),
        None => None,
    };
    let rules = RuleSet::parse(EDITORIAL_RULES).map_err(BackendError::Upstream)?;
    let keys: Vec<Option<&str>> = req.offered.iter().map(|o| o.as_deref()).collect();
    // Contexte (popularite, combos) pour les comparaisons courtes uniquement.
    let dataset = if keys.len() <= 6 { get_dataset(State(s.clone())).await.ok().map(|j| j.0) } else { None };
    let context = keys.iter().map(|k| nex_mayhem::provider::card_context(dataset.as_ref(), req.champion.as_deref(), *k, &req.confirmed)).collect();
    let ctx = nex_mayhem::Context { champion: profile.as_ref(), items: Default::default(), confirmed: req.confirmed, orientation: req.orientation };
    let ratings = nex_mayhem::rate(&rules, Some(&cat), &ctx, &keys);
    Ok(Json(RateResult { best: nex_mayhem::best_affinity(&ratings), ratings, profile, rules_version: rules.version, context }))
}
