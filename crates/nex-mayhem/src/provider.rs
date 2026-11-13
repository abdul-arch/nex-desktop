//! Fournisseurs de donnees Mayhem, avec capacites declarees et provenance de chaque valeur.
//!
//! Fournisseur integre : export public d'arammayhem.com (`/data/v1`), licence CC BY 4.0,
//! attribution « Data: arammayhem.com ». Contenu verifie le 8 novembre 2026 :
//! popularite (pick rate et son rang global), presence, patchs d'introduction et de retrait,
//! combos avec etiquettes editoriales. **Exclus par la source** : taux de victoire, tiers et
//! rangs fondes sur les taux de victoire. Les tiers visibles sur le site ou via son MCP ne sont
//! pas publies sous licence : ils ne sont pas importes.
//!
//! Regles : aucune valeur absente n'est fabriquee ; un rang de popularite n'est jamais un
//! classement de puissance ; une frequence n'est ni une probabilite de victoire ni une preuve
//! de qualite ; chaque ecart inexplique est signale, jamais corrige en silence.

use crate::catalog::MayhemCatalog;
use crate::matching::normalize;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Ce qu'un fournisseur fournit reellement.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub catalog: bool,
    pub popularity: bool,
    pub global_tiers: bool,
    pub champion_augment_tiers: bool,
    pub builds: bool,
    pub combos: bool,
    pub history: bool,
}

/// Interface commune des fournisseurs (l'acquisition reseau reste dans l'application).
pub trait MayhemDataProvider {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;
}

pub struct ArammayhemExport;

impl MayhemDataProvider for ArammayhemExport {
    fn id(&self) -> &'static str {
        "arammayhem.com/data/v1"
    }
    fn capabilities(&self) -> Capabilities {
        // Historique : fichiers par patch disponibles (champions, augments) ; non importes ici.
        Capabilities { catalog: true, popularity: true, global_tiers: false, champion_augment_tiers: false, builds: false, combos: true, history: true }
    }
}

pub const INDEX_URL: &str = "https://arammayhem.com/data/v1/index.json";
pub const LATEST_BASE: &str = "https://arammayhem.com/data/v1/latest";

/// Provenance commune d'un jeu de donnees importe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub provider: String,
    pub url: String,
    pub mode: String,
    /// Patch annonce par la source (ex. `26.22`).
    pub patch: Option<String>,
    pub patch_release_date: Option<String>,
    pub stats_date: Option<String>,
    /// `release` ou `estimated` (date des statistiques estimee par la source).
    pub stats_date_source: Option<String>,
    pub compared_to_patch: Option<String>,
    pub release_id: Option<String>,
    pub fetched_at: i64,
    pub scope: Option<String>,
    pub license: String,
    pub license_url: String,
    pub attribution: String,
    pub attribution_url: String,
    pub data_source: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MappingStatus {
    /// Nom anglais identique a un seul augment du catalogue Riot.
    Exact,
    /// Correspondance par alias controle (renommage connu).
    Alias,
    /// Plusieurs augments du catalogue possibles : pas de correspondance retenue.
    Ambiguous,
    /// Aucun augment du catalogue Riot ne correspond (retire, renomme ou absent du client).
    Unmapped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AugmentStat {
    /// Identifiant du fournisseur (ex. `transmute_prismatic`), distinct de la cle Riot.
    pub provider_id: String,
    /// Cle du catalogue Riot (`augmentNameId`) si la correspondance est sure.
    pub nex_key: Option<String>,
    pub mapping: MappingStatus,
    pub name_en: String,
    pub rarity: Option<String>,
    pub introduced_patch: Option<String>,
    pub retired_patch: Option<String>,
    /// Pick rate en pourcentage, tel que publie (denominateur non documente par la source).
    pub pick_rate: Option<f64>,
    /// Rang par pick rate parmi toutes les lignes de l'export (egalites partagees).
    pub pick_rate_rank: Option<u32>,
    pub previous_pick_rate: Option<f64>,
    pub pick_rate_change: Option<f64>,
    pub pick_rate_rank_change: Option<i32>,
    pub presence: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionStat {
    /// Cle Riot du champion (ex. `Ashe`).
    pub champion_id: String,
    pub name_en: String,
    pub pick_rate: Option<f64>,
    pub pick_rate_rank: Option<u32>,
    pub pick_rate_change: Option<f64>,
    pub pick_rate_rank_change: Option<i32>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Combo {
    pub combo_id: u32,
    pub champion_id: String,
    /// Identifiants du fournisseur.
    pub augment_ids: Vec<String>,
    /// Etiquettes editoriales de la source (god, strong, trap, blackTech, entertainment, bug).
    pub types: Vec<String>,
    pub url: Option<String>,
    /// Tous les augments du combo existent dans le catalogue Riot du patch (calcule a la
    /// correspondance). Sinon combo historique : non realisable aujourd'hui, masque.
    #[serde(default)]
    pub in_pool: bool,
}

impl Combo {
    /// Interaction signalee comme bug ou douteuse : exclue des recommandations automatiques.
    pub fn needs_verification(&self) -> bool {
        self.types.iter().any(|t| t == "bug")
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dataset {
    pub provenance: Provenance,
    pub capabilities: Capabilities,
    pub augments: Vec<AugmentStat>,
    pub champions: Vec<ChampionStat>,
    pub combos: Vec<Combo>,
    /// Ecarts detectes (retires encore mesures, patch different du client...).
    pub anomalies: Vec<String>,
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(|x| x.chars().filter(|c| !c.is_control()).take(120).collect())
}
fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite())
}
fn u(v: &Value, k: &str) -> Option<u32> {
    v.get(k).and_then(Value::as_u64).and_then(|x| u32::try_from(x).ok())
}
fn i(v: &Value, k: &str) -> Option<i32> {
    v.get(k).and_then(Value::as_i64).and_then(|x| i32::try_from(x).ok())
}
fn name_en(v: &Value, k: &str) -> Option<String> {
    match v.get(k) {
        Some(Value::String(x)) => Some(x.clone()),
        Some(o) => o.get("en").and_then(Value::as_str).map(str::to_string),
        None => None,
    }
}
/// Identifiant fournisseur : compare seulement, jamais insere dans un chemin ou une URL.
/// « ! » est accepte (ex. `stats!`, `get_excited!` dans l'export reel).
fn safe_id(x: &str) -> bool {
    !x.is_empty() && x.len() <= 80 && x.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'!'))
}
fn safe_url(x: &str) -> bool {
    x.starts_with("https://arammayhem.com/") && x.len() <= 200 && !x.contains("..") && x.bytes().all(|b| b.is_ascii_graphic())
}

/// Verifie l'en-tete d'un fichier de l'export (schema, licence). Refuse un contenu inattendu.
fn check_header(file: &Value, name: &str) -> Result<(), String> {
    if file.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(format!("{name} : version de schema inattendue"));
    }
    let lic = file.get("license").and_then(Value::as_str).unwrap_or("");
    if !lic.contains("CC BY 4.0") && !lic.contains("Attribution 4.0") {
        return Err(format!("{name} : licence inattendue ({lic})"));
    }
    if !file.get("rows").is_some_and(Value::is_array) {
        return Err(format!("{name} : lignes absentes"));
    }
    Ok(())
}

/// Lit l'export (augments, champions, combos) et l'index ; valide avant usage.
pub fn parse_arammayhem(index: &Value, augments: &Value, champions: &Value, combos: &Value, fetched_at: i64) -> Result<Dataset, String> {
    if index.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("index : version de schema inattendue".into());
    }
    check_header(augments, "augments")?;
    check_header(champions, "champions")?;
    check_header(combos, "combos")?;
    let lic = index.get("license").cloned().unwrap_or(Value::Null);
    let meta = augments.get("meta").cloned().unwrap_or(Value::Null);
    let mut anomalies = Vec::new();
    // Une meme publication pour tous les fichiers : sinon on ne melange pas en silence.
    let rid = |v: &Value| v.get("meta").and_then(|m| m.get("releaseId")).and_then(Value::as_str).map(str::to_string);
    let release_id = rid(augments);
    if rid(champions) != release_id || rid(combos) != release_id || index.get("releaseId").and_then(Value::as_str).map(str::to_string) != release_id {
        return Err("publications differentes entre l'index et les fichiers : import refuse".into());
    }
    let provenance = Provenance {
        provider: ArammayhemExport.id().into(),
        url: LATEST_BASE.into(),
        mode: "KIWI".into(),
        patch: s(&meta, "patch"),
        patch_release_date: s(&meta, "patchReleaseDate"),
        stats_date: s(&meta, "statsDate"),
        stats_date_source: s(&meta, "statsDateSource"),
        compared_to_patch: meta.get("comparedTo").and_then(|c| s(c, "patch")),
        release_id,
        fetched_at,
        scope: lic.get("scope").and_then(Value::as_str).map(str::to_string),
        license: lic.get("name").and_then(Value::as_str).unwrap_or("CC BY 4.0").to_string(),
        license_url: lic.get("url").and_then(Value::as_str).unwrap_or("https://creativecommons.org/licenses/by/4.0/").to_string(),
        attribution: lic.get("attribution").and_then(Value::as_str).unwrap_or("Data: arammayhem.com").to_string(),
        attribution_url: "https://arammayhem.com/data/".into(),
        data_source: index.get("dataSource").and_then(|d| d.as_str().map(str::to_string).or_else(|| d.get("description").and_then(Value::as_str).map(str::to_string))),
    };
    let rows = |v: &Value| v.get("rows").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut augs = Vec::new();
    for r in rows(augments).iter().take(1000) {
        let (Some(id), Some(name)) = (s(r, "augmentId"), name_en(r, "name")) else { continue };
        if !safe_id(&id) {
            continue;
        }
        let a = AugmentStat {
            provider_id: id,
            nex_key: None,
            mapping: MappingStatus::Unmapped,
            name_en: name.chars().take(80).collect(),
            rarity: s(r, "rarity").filter(|x| matches!(x.as_str(), "silver" | "gold" | "prismatic")),
            introduced_patch: s(r, "introducedPatch"),
            retired_patch: s(r, "retiredPatch"),
            pick_rate: f(r, "pickRate").filter(|p| (0.0..=100.0).contains(p)),
            pick_rate_rank: u(r, "pickRateRank"),
            previous_pick_rate: f(r, "previousPickRate"),
            pick_rate_change: f(r, "pickRateChange"),
            pick_rate_rank_change: i(r, "pickRateRankChange"),
            presence: s(r, "presence"),
            url: s(r, "url").filter(|x| safe_url(x)),
        };
        if a.retired_patch.is_some() && a.pick_rate.is_some() {
            anomalies.push(format!(
                "{} : retiré au patch {} mais mesuré au patch {} (écart inexpliqué, à vérifier)",
                a.provider_id,
                a.retired_patch.as_deref().unwrap_or("?"),
                provenance.patch.as_deref().unwrap_or("?")
            ));
        }
        augs.push(a);
    }
    let champs = rows(champions)
        .iter()
        .take(400)
        .filter_map(|r| {
            let id = s(r, "championId").filter(|x| safe_id(x))?;
            Some(ChampionStat {
                name_en: name_en(r, "name").unwrap_or_else(|| id.clone()),
                champion_id: id,
                pick_rate: f(r, "pickRate").filter(|p| (0.0..=100.0).contains(p)),
                pick_rate_rank: u(r, "pickRateRank"),
                pick_rate_change: f(r, "pickRateChange"),
                pick_rate_rank_change: i(r, "pickRateRankChange"),
                url: s(r, "url").filter(|x| safe_url(x)),
            })
        })
        .collect();
    let combos = rows(combos)
        .iter()
        .take(5000)
        .filter_map(|r| {
            let ids: Vec<String> = r.get("augmentIds")?.as_array()?.iter().filter_map(Value::as_str).filter(|x| safe_id(x)).take(20).map(str::to_string).collect();
            Some(Combo {
                combo_id: u(r, "comboId")?,
                champion_id: s(r, "championId").filter(|x| safe_id(x))?,
                augment_ids: ids,
                types: r.get("types").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).filter(|x| safe_id(x)).take(8).map(str::to_string).collect()).unwrap_or_default(),
                url: s(r, "url").filter(|x| safe_url(x)),
                in_pool: false,
            })
        })
        .collect();
    Ok(Dataset { capabilities: ArammayhemExport.capabilities(), provenance, augments: augs, champions: champs, combos, anomalies })
}

/// Alias controles : identifiant fournisseur -> cle Riot, pour les noms qui different.
/// Chaque entree est verifiee a la main (cle Riot explicite + meme rarete), le 8 novembre 2026 :
/// la source prefixe les quetes par « Quest: », pas le client.
pub const ALIASES: &[(&str, &str)] = &[
    ("quest_steel_your_heart", "ARAM_Quest_SteelYourHeart"),
    ("quest_wooglets_witchcap", "ARAM_Quest_WoogletsWitchcap"),
    ("quest_urfs_champion", "ARAM_Quest_UrfsChampion"),
];

fn rarity_label(r: crate::catalog::Rarity) -> &'static str {
    match r {
        crate::catalog::Rarity::Silver => "silver",
        crate::catalog::Rarity::Gold => "gold",
        crate::catalog::Rarity::Prismatic => "prismatic",
        crate::catalog::Rarity::Other => "other",
    }
}

/// Prefixe des ecarts produits par la correspondance (distincts des ecarts de l'export).
const MAPPING_ANOMALY: &str = "correspondance : ";

/// Correspondance explicite fournisseur -> catalogue Riot, par nom anglais normalise.
/// Deux augments Riot de meme nom : ambigu, aucune correspondance retenue.
pub fn map_to_catalog(ds: &mut Dataset, catalog: &MayhemCatalog) {
    let mut by_name: BTreeMap<String, Vec<&str>> = BTreeMap::new();
    for a in &catalog.augments {
        by_name.entry(normalize(&a.name_en)).or_default().push(a.key.as_str());
    }
    // Relier a nouveau remplace les ecarts de la correspondance precedente (pas de doublon).
    ds.anomalies.retain(|a| !a.starts_with(MAPPING_ANOMALY));
    let mut seen: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for a in &mut ds.augments {
        a.nex_key = None;
        if let Some((_, key)) = ALIASES.iter().find(|(p, _)| *p == a.provider_id) {
            // Alias accepte seulement si la cle existe et que la rarete concorde.
            match catalog.get(key) {
                Some(c) if a.rarity.as_deref().is_none_or(|r| r == rarity_label(c.rarity)) => {
                    a.nex_key = Some((*key).to_string());
                    a.mapping = MappingStatus::Alias;
                }
                Some(_) => ds.anomalies.push(format!("{MAPPING_ANOMALY}alias {} -> {key} refusé : rareté différente", a.provider_id)),
                None => a.mapping = MappingStatus::Unmapped,
            }
        } else {
            match by_name.get(&normalize(&a.name_en)).map(Vec::as_slice) {
                Some([one]) => {
                    a.nex_key = Some((*one).to_string());
                    a.mapping = MappingStatus::Exact;
                }
                Some(_) => a.mapping = MappingStatus::Ambiguous,
                None => a.mapping = MappingStatus::Unmapped,
            }
        }
        if let Some(k) = &a.nex_key {
            seen.entry(k.clone()).or_default().push(a.provider_id.clone());
        }
    }
    // Collision : deux identifiants fournisseur vers la meme cle Riot -> aucune n'est retenue.
    for (key, ids) in seen.into_iter().filter(|(_, v)| v.len() > 1) {
        for a in ds.augments.iter_mut().filter(|a| a.nex_key.as_deref() == Some(key.as_str())) {
            a.nex_key = None;
            a.mapping = MappingStatus::Ambiguous;
        }
        ds.anomalies.push(format!("{MAPPING_ANOMALY}collision vers {key} : {}", ids.join(", ")));
    }
    // Pool du patch : chaque augment du combo est dans l'export et dans le catalogue Riot
    // (relie, ou ambigu entre deux augments Riot). Un identifiant absent de l'export ou non
    // relie designe un augment retire : le combo n'est pas realisable aujourd'hui.
    let present: BTreeMap<&str, MappingStatus> = ds.augments.iter().map(|a| (a.provider_id.as_str(), a.mapping)).collect();
    let in_pool: Vec<bool> = ds
        .combos
        .iter()
        .map(|c| !c.augment_ids.is_empty() && c.augment_ids.iter().all(|id| present.get(id.as_str()).is_some_and(|m| *m != MappingStatus::Unmapped)))
        .collect();
    for (c, p) in ds.combos.iter_mut().zip(in_pool) {
        c.in_pool = p;
    }
    // Patch : la source numerote 26.x, le client Riot 16.x (meme saison). Ecart signale.
    if let (Some(src), Some(client)) = (ds.provenance.patch.as_deref(), riot_season_patch(&catalog.patch)) {
        if src != client {
            ds.anomalies.push(format!("{MAPPING_ANOMALY}patch de la source {src} différent du patch du client {client} : statistiques possiblement antérieures"));
        }
    }
}

/// Copie reliee au catalogue courant. Le cache garde l'export brut : un changement de patch
/// du client refait la correspondance sans attendre une nouvelle publication de la source.
pub fn mapped(raw: &Dataset, catalog: &MayhemCatalog) -> Dataset {
    let mut ds = raw.clone();
    map_to_catalog(&mut ds, catalog);
    ds
}

/// Numero de patch affiche par le jeu (saison 2026 : `26.x`) a partir de la version client
/// (`16.x`). Hypothese documentee ; toute incoherence est signalee, jamais corrigee.
pub fn riot_season_patch(client_version: &str) -> Option<String> {
    let mut it = client_version.split('.');
    let major: u32 = it.next()?.parse().ok()?;
    let minor: u32 = it.next()?.parse().ok()?;
    (major >= 15).then(|| format!("{}.{minor}", major + 10))
}

impl Dataset {
    pub fn augment_by_key(&self, key: &str) -> Option<&AugmentStat> {
        self.augments.iter().find(|a| a.nex_key.as_deref() == Some(key))
    }
    pub fn provider_key(&self, provider_id: &str) -> Option<&str> {
        self.augments.iter().find(|a| a.provider_id == provider_id).and_then(|a| a.nex_key.as_deref())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComboStatus {
    /// Tous les autres augments du combo sont deja confirmes : interaction realisable.
    Active,
    /// Il manque encore des augments : projet incertain (tirages a venir).
    Project,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComboNote {
    pub combo_id: u32,
    pub status: ComboStatus,
    /// Nombre d'augments du combo (1 : l'augment seul est documente pour ce champion).
    pub size: usize,
    /// Augments manquants (cles Riot quand la correspondance est sure, sinon id fournisseur).
    pub missing: Vec<String>,
    pub types: Vec<String>,
    pub needs_verification: bool,
    pub url: Option<String>,
}

/// Combos documentes pour ce champion contenant cet augment.
fn combos_with<'a>(ds: &'a Dataset, champion: &'a str, key: &'a str) -> impl Iterator<Item = &'a Combo> {
    ds.combos
        .iter()
        .filter(move |c| c.champion_id.eq_ignore_ascii_case(champion) && c.augment_ids.iter().any(|id| ds.provider_key(id) == Some(key)))
}

/// Combos du pool actuel pour ce champion contenant cet augment, du plus concret au plus
/// incertain : realisables, puis a verifier, puis projets par nombre d'augments manquants.
/// Les combos historiques (augment retire) sont exclus. Information seulement : aucun bonus
/// de note (pas de conditions ni de validation publiees).
pub fn combos_for(ds: &Dataset, champion: &str, key: &str, confirmed: &[String]) -> Vec<ComboNote> {
    let mut notes: Vec<ComboNote> = combos_with(ds, champion, key)
        .filter(|c| c.in_pool)
        .filter_map(|c| {
            let keys: Vec<Option<&str>> = c.augment_ids.iter().map(|id| ds.provider_key(id)).collect();
            if !keys.contains(&Some(key)) {
                return None;
            }
            let missing: Vec<String> = c
                .augment_ids
                .iter()
                .zip(&keys)
                .filter(|(_, k)| **k != Some(key) && !k.is_some_and(|k| confirmed.iter().any(|x| x == k)))
                .map(|(id, k)| k.map(str::to_string).unwrap_or_else(|| id.clone()))
                .collect();
            Some(ComboNote {
                combo_id: c.combo_id,
                status: if missing.is_empty() { ComboStatus::Active } else { ComboStatus::Project },
                size: c.augment_ids.len(),
                missing,
                types: c.types.clone(),
                needs_verification: c.needs_verification(),
                url: c.url.clone(),
            })
        })
        .collect();
    let rank = |n: &ComboNote| match (n.needs_verification, n.status) {
        (false, ComboStatus::Active) => 0,
        (true, _) => 1,
        (false, ComboStatus::Project) => 1 + n.missing.len(),
    };
    notes.sort_by_key(|n| (rank(n), n.combo_id));
    notes
}

/// Nombre maximal de combos transmis par carte (le total reste indique).
pub const COMBOS_PER_CARD: usize = 12;

/// Popularite d'un augment selon la source, avec son perimetre et sa date.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopularityView {
    pub pick_rate: Option<f64>,
    pub pick_rate_rank: Option<u32>,
    /// Nombre de lignes de l'export : perimetre du rang (tous les augments, pas une rarete).
    pub rank_scope: usize,
    pub pick_rate_change: Option<f64>,
    pub presence: Option<String>,
    pub retired_patch: Option<String>,
    pub patch: Option<String>,
    pub stats_date: Option<String>,
    pub stats_date_source: Option<String>,
    pub url: Option<String>,
    pub attribution: String,
}

/// Contexte d'une carte : informatif, jamais utilise pour calculer la note.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardContext {
    pub popularity: Option<PopularityView>,
    pub combos: Vec<ComboNote>,
    /// Nombre total de combos du pool actuel (au-dela des `COMBOS_PER_CARD` transmis).
    #[serde(default)]
    pub combos_total: usize,
    /// Combos historiques masques : un augment absent du patch actuel ou non relie.
    #[serde(default)]
    pub combos_outside_pool: usize,
}

pub fn card_context(ds: Option<&Dataset>, champion: Option<&str>, key: Option<&str>, confirmed: &[String]) -> CardContext {
    let (Some(ds), Some(key)) = (ds, key) else { return CardContext::default() };
    let popularity = ds.augment_by_key(key).map(|a| PopularityView {
        pick_rate: a.pick_rate,
        pick_rate_rank: a.pick_rate_rank,
        rank_scope: ds.augments.len(),
        pick_rate_change: a.pick_rate_change,
        presence: a.presence.clone(),
        retired_patch: a.retired_patch.clone(),
        patch: ds.provenance.patch.clone(),
        stats_date: ds.provenance.stats_date.clone(),
        stats_date_source: ds.provenance.stats_date_source.clone(),
        url: a.url.clone(),
        attribution: ds.provenance.attribution.clone(),
    });
    let mut combos = champion.map(|c| combos_for(ds, c, key, confirmed)).unwrap_or_default();
    let combos_total = combos.len();
    let combos_outside_pool = champion.map(|c| combos_with(ds, c, key).filter(|c| !c.in_pool).count()).unwrap_or(0);
    combos.truncate(COMBOS_PER_CARD);
    CardContext { popularity, combos, combos_total, combos_outside_pool }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{Augment, Rarity};
    use serde_json::json;

    fn file(rows: Value, release: &str) -> Value {
        json!({"schemaVersion": 1, "license": "CC BY 4.0", "meta": {"patch": "26.22", "statsDate": "2026-11-07", "statsDateSource": "release", "releaseId": release}, "rows": rows})
    }
    fn index(release: &str) -> Value {
        json!({"schemaVersion": 1, "releaseId": release, "latestPatch": "26.22", "license": {"name": "CC BY 4.0", "attribution": "Data: arammayhem.com", "scope": "Pick rates only."}})
    }
    fn catalog() -> MayhemCatalog {
        let a = |key: &str, en: &str| Augment { id: 0, key: key.into(), name_en: en.into(), name_fr: en.into(), rarity: Rarity::Gold, icon: String::new() };
        MayhemCatalog {
            mode: "KIWI".into(),
            patch: "16.22".into(),
            fetched_at: 0,
            source: "t".into(),
            augments: vec![a("ARAM_TransmutePrismatic", "Transmute: Prismatic"), a("Twin_A", "Twin"), a("Twin_B", "Twin"), a("KingMe", "King Me")],
        }
    }
    fn dataset() -> Dataset {
        let r = "rel1";
        let augs = file(
            json!([
                {"augmentId": "transmute_prismatic", "name": {"en": "Transmute: Prismatic"}, "rarity": "gold", "pickRate": 60.53, "pickRateRank": 1},
                {"augmentId": "twin", "name": {"en": "Twin"}, "rarity": "silver", "pickRate": 3.1, "pickRateRank": 150},
                {"augmentId": "king_me", "name": {"en": "King Me"}, "rarity": "prismatic", "pickRate": 1.0, "pickRateRank": 200},
                {"augmentId": "clown_college", "name": {"en": "Clown College"}, "rarity": "gold", "retiredPatch": "26.17", "pickRate": 28.08, "pickRateRank": 9},
                {"augmentId": "../evil", "name": {"en": "X"}}
            ]),
            r,
        );
        let champs = file(json!([{"championId": "Ryze", "name": {"en": "Ryze"}, "pickRate": 5.0, "pickRateRank": 40}]), r);
        let combos = file(
            json!([
                {"comboId": 7, "championId": "Ryze", "augmentIds": ["transmute_prismatic", "king_me"], "types": ["strong"]},
                {"comboId": 8, "championId": "Ryze", "augmentIds": ["king_me"], "types": ["bug"]},
                {"comboId": 9, "championId": "Ryze", "augmentIds": ["transmute_prismatic", "king_me", "twin"], "types": []},
                {"comboId": 10, "championId": "Ryze", "augmentIds": ["transmute_prismatic"], "types": ["god"]},
                {"comboId": 11, "championId": "Ryze", "augmentIds": ["transmute_prismatic", "void_rift"], "types": ["strong"]},
                {"comboId": 12, "championId": "Ryze", "augmentIds": ["transmute_prismatic", "clown_college"], "types": []}
            ]),
            r,
        );
        mapped(&parse_arammayhem(&index(r), &augs, &champs, &combos, 1).unwrap(), &catalog())
    }

    #[test]
    fn remapping_follows_the_current_catalog() {
        let ds = dataset();
        // Nouveau patch du client : Transmute retire du catalogue, King Me renomme cote Riot.
        let mut next = catalog();
        next.patch = "16.23".into();
        next.augments.retain(|a| a.key != "ARAM_TransmutePrismatic");
        let again = mapped(&ds, &next);
        let get = |d: &Dataset, id: &str| d.augments.iter().find(|a| a.provider_id == id).map(|a| (a.nex_key.clone(), a.mapping)).unwrap();
        assert_eq!(get(&again, "transmute_prismatic"), (None, MappingStatus::Unmapped), "ancienne cle oubliee");
        assert_eq!(get(&again, "king_me"), (Some("KingMe".into()), MappingStatus::Exact));
        assert!(again.anomalies.iter().any(|a| a.contains("16.23") || a.contains("26.23")), "ecart de patch signale");
        // Relier deux fois donne le meme resultat (aucune anomalie dupliquee).
        assert_eq!(mapped(&ds, &catalog()).anomalies, ds.anomalies);
    }

    #[test]
    fn popularity_only_export_declares_no_tiers() {
        let ds = dataset();
        let caps = ds.capabilities;
        assert!(caps.popularity && caps.combos);
        assert!(!caps.global_tiers && !caps.champion_augment_tiers && !caps.builds, "aucune capacite de tier annoncee");
        assert_eq!(ds.augments.len(), 4, "identifiant non sur ignore");
        assert_eq!(ds.provenance.attribution, "Data: arammayhem.com");
        assert_eq!(ds.provenance.stats_date_source.as_deref(), Some("release"));
    }

    #[test]
    fn mapping_handles_exact_ambiguous_and_unmapped() {
        let ds = dataset();
        let get = |id: &str| ds.augments.iter().find(|a| a.provider_id == id).unwrap();
        assert_eq!(get("transmute_prismatic").nex_key.as_deref(), Some("ARAM_TransmutePrismatic"));
        assert_eq!(get("transmute_prismatic").mapping, MappingStatus::Exact);
        assert_eq!(get("twin").mapping, MappingStatus::Ambiguous, "deux augments Riot du meme nom");
        assert!(get("twin").nex_key.is_none());
        assert_eq!(get("clown_college").mapping, MappingStatus::Unmapped);
        assert!(ds.anomalies.iter().any(|a| a.contains("clown_college")), "retire mais mesure : signale");
    }

    #[test]
    fn mismatched_releases_are_refused() {
        let augs = file(json!([]), "rel1");
        let other = file(json!([]), "rel2");
        assert!(parse_arammayhem(&index("rel1"), &augs, &other, &augs, 1).is_err());
        let mut bad = augs.clone();
        bad["license"] = json!("All rights reserved");
        assert!(parse_arammayhem(&index("rel1"), &bad, &augs, &augs, 1).is_err());
    }

    #[test]
    fn combos_are_active_or_project_and_bugs_flagged() {
        let ds = dataset();
        let notes = combos_for(&ds, "Ryze", "ARAM_TransmutePrismatic", &[]);
        // Ordre : l'augment seul (realisable), puis les projets du plus proche au plus lointain.
        assert_eq!(notes.iter().map(|n| n.combo_id).collect::<Vec<_>>(), vec![10, 7, 9]);
        assert_eq!((notes[0].status, notes[0].size), (ComboStatus::Active, 1));
        assert_eq!(notes[1].status, ComboStatus::Project);
        assert_eq!(notes[1].missing, vec!["KingMe".to_string()]);
        // Augment non relie (ambigu) : reste nomme par son id fournisseur.
        assert_eq!(notes[2].missing, vec!["KingMe".to_string(), "twin".to_string()]);
        let active = combos_for(&ds, "Ryze", "ARAM_TransmutePrismatic", &["KingMe".into()]);
        assert_eq!(active.iter().filter(|n| n.status == ComboStatus::Active).count(), 2);
        let bug = combos_for(&ds, "Ryze", "KingMe", &[]);
        assert!(bug[0].needs_verification, "interaction signalee bug : avant les projets");
        assert!(combos_for(&ds, "Ashe", "KingMe", &[]).is_empty());
    }

    #[test]
    fn card_context_is_information_with_scoped_rank() {
        let ds = dataset();
        let ctx = card_context(Some(&ds), Some("Ryze"), Some("ARAM_TransmutePrismatic"), &[]);
        let pop = ctx.popularity.unwrap();
        // Rang 1 par pick rate parmi toutes les lignes de l'export : ni un tier ni une rarete.
        assert_eq!((pop.pick_rate_rank, pop.rank_scope), (Some(1), 4));
        assert_eq!(pop.attribution, "Data: arammayhem.com");
        // 11 (augment absent de l'export) et 12 (augment retire, non relie) : historiques.
        assert_eq!((ctx.combos_total, ctx.combos_outside_pool), (3, 2));
        assert!(ds.combos.iter().filter(|c| c.combo_id >= 11).all(|c| !c.in_pool));
        assert!(ds.combos.iter().find(|c| c.combo_id == 9).unwrap().in_pool, "augment ambigu : bien dans le catalogue Riot");
        // Sans donnees ou sans augment reconnu : contexte vide, jamais invente.
        assert_eq!(card_context(None, Some("Ryze"), Some("ARAM_TransmutePrismatic"), &[]), CardContext::default());
        assert!(card_context(Some(&ds), Some("Ryze"), Some("Inconnu"), &[]).popularity.is_none());
    }

    #[test]
    fn season_patch_mapping_is_explicit() {
        assert_eq!(riot_season_patch("16.22").as_deref(), Some("26.22"));
        assert_eq!(riot_season_patch("bad"), None);
        let ds = dataset();
        assert!(!ds.anomalies.iter().any(|a| a.contains("patch de la source")), "26.22 = 16.22");
    }
}
