//! Data Dragon : ressources statiques versionnees publiees par Riot.
//! Seule source distante appelee directement par le client (pas de cle requise).

use crate::error::{AppError, AppResult};
use crate::persistence::{Db, cache};
use serde::Serialize;

const VERSIONS_URL: &str = "https://ddragon.leagueoflegends.com/api/versions.json";
const VERSIONS_KEY: &str = "ddragon:versions";
const VERSIONS_TTL_SECS: i64 = 6 * 3600;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticDataVersion {
    pub version: String,
    pub fetched_at: i64,
    /// "network" | "cache" | "stale-cache" (reseau en echec, cache expire reutilise)
    pub source: &'static str,
}

fn first_version(body: &str) -> AppResult<String> {
    let versions: Vec<String> = serde_json::from_str(body)?;
    let v = versions
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Unavailable("aucune version Data Dragon".into()))?;
    // Format attendu : 15.21.1 ; refuse tout le reste (la valeur sert a construire des URLs).
    if v.split('.').count() == 3 && v.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())) {
        Ok(v)
    } else {
        Err(AppError::Unavailable(format!("version Data Dragon inattendue : {v}")))
    }
}

pub async fn latest_version(db: &Db, http: &reqwest::Client) -> AppResult<StaticDataVersion> {
    let cached = db.with(|c| cache::get(c, VERSIONS_KEY))?;
    if let Some(entry) = &cached {
        if entry.fresh {
            return Ok(StaticDataVersion {
                version: first_version(&entry.body)?,
                fetched_at: entry.fetched_at,
                source: "cache",
            });
        }
    }

    let fetched: AppResult<String> = async {
        let resp = http.get(VERSIONS_URL).send().await?;
        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry = resp
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
                .unwrap_or(60);
            return Err(AppError::RateLimited { retry_after_secs: retry });
        }
        let resp = resp.error_for_status()?;
        Ok(resp.text().await?)
    }
    .await;

    match fetched {
        Ok(body) => {
            let version = first_version(&body)?;
            db.with(|c| cache::put(c, VERSIONS_KEY, &body, VERSIONS_TTL_SECS))?;
            Ok(StaticDataVersion {
                version,
                fetched_at: crate::persistence::now_secs(),
                source: "network",
            })
        }
        Err(err) => match cached {
            Some(entry) => Ok(StaticDataVersion {
                version: first_version(&entry.body)?,
                fetched_at: entry.fetched_at,
                source: "stale-cache",
            }),
            None => Err(err),
        },
    }
}

// ---------- Catalogue compact (champions, objets, sorts, runes) ----------

use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogChampion {
    pub key: String,
    pub name: String,
    /// Classes Data Dragon (Mage, Tank...).
    pub tags: Vec<String>,
    /// Notes Data Dragon 0-10 : degats physiques et magiques (profil indicatif, pas une statistique).
    pub attack: u32,
    pub magic: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub name: String,
    pub gold: u32,
    pub plaintext: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSpell {
    /// Nom de fichier image sans extension (ex. "SummonerFlash").
    pub image: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRune {
    pub name: String,
    /// Chemin relatif sous /cdn/img/ (valide : perk-images/...png).
    pub icon: String,
    /// Arbre parent (pour une rune) ou lui-meme (pour un arbre).
    pub style: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub version: String,
    pub lang: String,
    /// Cle = identifiant numerique du champion.
    pub champions: HashMap<i32, CatalogChampion>,
    pub items: HashMap<u32, CatalogItem>,
    pub spells: HashMap<u32, CatalogSpell>,
    /// Arbres et runes, par identifiant.
    pub runes: HashMap<u32, CatalogRune>,
}

#[derive(Deserialize)]
struct DdMap<T> {
    data: HashMap<String, T>,
}

#[derive(Deserialize)]
struct DdChampion {
    id: String,
    key: String,
    name: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    info: HashMap<String, u32>,
}

#[derive(Deserialize)]
struct DdItem {
    #[serde(default)]
    name: String,
    #[serde(default)]
    plaintext: String,
    #[serde(default)]
    gold: DdGold,
}

#[derive(Deserialize, Default)]
struct DdGold {
    #[serde(default)]
    total: u32,
}

#[derive(Deserialize)]
struct DdSpell {
    id: String,
    key: String,
    name: String,
}

#[derive(Deserialize)]
struct DdStyle {
    id: u32,
    name: String,
    icon: String,
    slots: Vec<DdSlot>,
}

#[derive(Deserialize)]
struct DdSlot {
    runes: Vec<DdRune>,
}

#[derive(Deserialize)]
struct DdRune {
    id: u32,
    name: String,
    icon: String,
}

const SAFE_LANGS: &[&str] = &["fr_FR", "en_US"];

fn safe_icon(path: &str) -> bool {
    path.starts_with("perk-images/")
        && path.ends_with(".png")
        && !path.contains("..")
        && path.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-' | b'.'))
}

fn safe_image_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

pub fn build_catalog(
    version: &str,
    lang: &str,
    champions: &str,
    items: &str,
    spells: &str,
    runes: &str,
) -> AppResult<Catalog> {
    let champions: DdMap<DdChampion> = serde_json::from_str(champions)?;
    let items: DdMap<DdItem> = serde_json::from_str(items)?;
    let spells: DdMap<DdSpell> = serde_json::from_str(spells)?;
    let styles: Vec<DdStyle> = serde_json::from_str(runes)?;

    let champions = champions
        .data
        .into_values()
        .filter(|c| safe_image_id(&c.id))
        .filter_map(|c| {
            let attack = c.info.get("attack").copied().unwrap_or(0);
            let magic = c.info.get("magic").copied().unwrap_or(0);
            Some((c.key.parse().ok()?, CatalogChampion { key: c.id, name: c.name, tags: c.tags, attack, magic }))
        })
        .collect();
    let items = items
        .data
        .into_iter()
        .filter_map(|(id, i)| {
            Some((id.parse().ok()?, CatalogItem { name: i.name, gold: i.gold.total, plaintext: i.plaintext }))
        })
        .collect();
    let spells = spells
        .data
        .into_values()
        .filter(|s| safe_image_id(&s.id))
        .filter_map(|s| Some((s.key.parse().ok()?, CatalogSpell { image: s.id, name: s.name })))
        .collect();
    let mut rune_map = HashMap::new();
    for st in styles {
        if safe_icon(&st.icon) {
            rune_map.insert(st.id, CatalogRune { name: st.name, icon: st.icon, style: st.id });
        }
        for r in st.slots.into_iter().flat_map(|s| s.runes) {
            if safe_icon(&r.icon) {
                rune_map.insert(r.id, CatalogRune { name: r.name, icon: r.icon, style: st.id });
            }
        }
    }
    Ok(Catalog { version: version.into(), lang: lang.into(), champions, items, spells, runes: rune_map })
}

async fn fetch_text(http: &reqwest::Client, url: String) -> AppResult<String> {
    Ok(http.get(url).send().await?.error_for_status()?.text().await?)
}

/// Catalogue compact pour une version et une langue, mis en cache 30 jours (donnee versionnee).
pub async fn catalog(db: &Db, http: &reqwest::Client, version: &str, lang: &str) -> AppResult<Catalog> {
    first_version(&format!("[\"{version}\"]"))?; // meme validation que la version courante
    if !SAFE_LANGS.contains(&lang) {
        return Err(AppError::InvalidInput("langue non prise en charge".into()));
    }
    let key = format!("ddragon:catalog:v2:{version}:{lang}");
    if let Some(entry) = db.with(|c| cache::get(c, &key))? {
        if let Ok(cat) = serde_json::from_str::<Catalog>(&entry.body) {
            return Ok(cat);
        }
    }
    let base = format!("https://ddragon.leagueoflegends.com/cdn/{version}/data/{lang}");
    let (c, i, s, r) = tokio::join!(
        fetch_text(http, format!("{base}/champion.json")),
        fetch_text(http, format!("{base}/item.json")),
        fetch_text(http, format!("{base}/summoner.json")),
        fetch_text(http, format!("{base}/runesReforged.json")),
    );
    let cat = build_catalog(version, lang, &c?, &i?, &s?, &r?)?;
    db.with(|c| cache::put(c, &key, &serde_json::to_string(&cat)?, 30 * 24 * 3600))?;
    Ok(cat)
}

// ---------- Fiche champion (competences, skins) ----------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionSpell {
    pub name: String,
    /// Texte brut (balises HTML de Data Dragon retirees).
    pub description: String,
    pub cooldown: String,
    pub cost: String,
    /// Nom de fichier image (valide).
    pub image: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionSkin {
    pub num: u32,
    pub name: String,
    pub chromas: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionInfo {
    pub version: String,
    pub key: String,
    pub id: i32,
    pub name: String,
    pub title: String,
    pub tags: Vec<String>,
    /// attaque, defense, magie, difficulte (0-10, valeurs Data Dragon).
    pub ratings: [u32; 4],
    pub resource: String,
    pub blurb: String,
    pub passive: ChampionSpell,
    pub spells: Vec<ChampionSpell>,
    pub skins: Vec<ChampionSkin>,
}

/// Retire les balises HTML (<br>, <magicDamage>...) et decode les entites courantes.
/// Le texte est ensuite affiche comme texte par React, jamais injecte en HTML.
pub fn strip_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for ch in input.chars() {
        match (in_tag, ch) {
            (false, '<') => {
                in_tag = true;
                tag.clear();
            }
            (true, '>') => {
                in_tag = false;
                let t = tag.trim().to_ascii_lowercase();
                if t.starts_with("br") || t.starts_with("li") || t == "/li" {
                    out.push('\n');
                }
            }
            (true, c) => tag.push(c),
            (false, c) => out.push(c),
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .lines()
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn safe_file(name: &str) -> bool {
    name.len() <= 64 && name.ends_with(".png") && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.')) && !name.contains("..")
}

#[derive(Deserialize)]
struct DdChampFile {
    data: HashMap<String, DdChampFull>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DdChampFull {
    id: String,
    key: String,
    name: String,
    title: String,
    tags: Vec<String>,
    info: HashMap<String, u32>,
    partype: String,
    blurb: String,
    passive: DdSpellFull,
    spells: Vec<DdSpellFull>,
    skins: Vec<DdSkin>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct DdSpellFull {
    name: String,
    description: String,
    cooldown_burn: String,
    cost_burn: String,
    image: DdImage,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DdImage {
    full: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DdSkin {
    num: u32,
    name: String,
    chromas: bool,
}

pub fn parse_champion(version: &str, key: &str, body: &str) -> AppResult<ChampionInfo> {
    let mut file: DdChampFile = serde_json::from_str(body)?;
    let c = file.data.remove(key).ok_or_else(|| AppError::NotFound(format!("champion inconnu : {key}")))?;
    let spell = |s: DdSpellFull| ChampionSpell {
        name: s.name,
        description: strip_tags(&s.description),
        cooldown: s.cooldown_burn,
        cost: s.cost_burn,
        image: if safe_file(&s.image.full) { s.image.full } else { String::new() },
    };
    let r = |k: &str| c.info.get(k).copied().unwrap_or(0);
    Ok(ChampionInfo {
        version: version.into(),
        id: c.key.parse().unwrap_or(0),
        key: c.id.clone(),
        name: c.name,
        title: c.title,
        tags: c.tags,
        ratings: [r("attack"), r("defense"), r("magic"), r("difficulty")],
        resource: c.partype,
        blurb: strip_tags(&c.blurb),
        passive: spell(c.passive),
        spells: c.spells.into_iter().map(spell).collect(),
        skins: c.skins.into_iter().map(|s| ChampionSkin { num: s.num, name: s.name, chromas: s.chromas }).collect(),
    })
}

pub async fn champion_info(db: &Db, http: &reqwest::Client, version: &str, lang: &str, key: &str) -> AppResult<ChampionInfo> {
    if !safe_image_id(key) {
        return Err(AppError::InvalidInput("cle de champion invalide".into()));
    }
    if !SAFE_LANGS.contains(&lang) {
        return Err(AppError::InvalidInput("langue non prise en charge".into()));
    }
    first_version(&format!("[\"{version}\"]"))?;
    let cache_key = format!("ddragon:champion:v1:{version}:{lang}:{key}");
    if let Some(entry) = db.with(|c| cache::get(c, &cache_key))? {
        if let Ok(info) = serde_json::from_str::<ChampionInfo>(&entry.body) {
            return Ok(info);
        }
    }
    let url = format!("https://ddragon.leagueoflegends.com/cdn/{version}/data/{lang}/champion/{key}.json");
    let resp = http.get(url).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND || resp.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::NotFound(format!("champion inconnu : {key}")));
    }
    let body = resp.error_for_status()?.text().await?;
    let info = parse_champion(version, key, &body)?;
    db.with(|c| cache::put(c, &cache_key, &serde_json::to_string(&info)?, 30 * 24 * 3600))?;
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_markup() {
        assert_eq!(
            strip_tags("Inflige <magicDamage>40 dégâts</magicDamage>.<br><br>Puis &nbsp;soigne <script>x</script>"),
            "Inflige 40 dégâts.\n\nPuis  soigne x"
        );
    }

    #[test]
    fn parses_champion_file() {
        let body = r#"{"data":{"Ahri":{"id":"Ahri","key":"103","name":"Ahri","title":"le renard à neuf queues","tags":["Mage","Assassin"],
          "info":{"attack":3,"defense":4,"magic":8,"difficulty":5},"partype":"Mana","blurb":"Texte <i>riche</i>",
          "passive":{"name":"Vol d'essence","description":"P","image":{"full":"Ahri_SoulEater2.png"}},
          "spells":[{"name":"Orbe","description":"<b>A</b>","cooldownBurn":"7","costBurn":"55","image":{"full":"../evil.png"}}],
          "skins":[{"num":0,"name":"default","chromas":false},{"num":27,"name":"Ahri fleur spirituelle","chromas":true}]}}}"#;
        let c = parse_champion("16.20.1", "Ahri", body).unwrap();
        assert_eq!(c.id, 103);
        assert_eq!(c.blurb, "Texte riche");
        assert_eq!(c.spells[0].description, "A");
        assert_eq!(c.spells[0].image, "");
        assert_eq!(c.passive.image, "Ahri_SoulEater2.png");
        assert_eq!(c.skins.len(), 2);
        assert!(parse_champion("16.20.1", "Zed", body).is_err());
    }

    #[test]
    fn builds_catalog_and_filters_unsafe_paths() {
        let cat = build_catalog(
            "15.22.1",
            "fr_FR",
            r#"{"data":{"MonkeyKing":{"id":"MonkeyKing","key":"62","name":"Wukong"},"Bad":{"id":"../x","key":"1","name":"x"}}}"#,
            r#"{"data":{"3089":{"name":"Coiffe","plaintext":"PA","gold":{"total":3500}}}}"#,
            r#"{"data":{"SummonerFlash":{"id":"SummonerFlash","key":"4","name":"Saut éclair"}}}"#,
            r#"[{"id":8100,"name":"Domination","icon":"perk-images/Styles/7200_Domination.png","slots":[{"runes":[{"id":8112,"name":"Électrocution","icon":"perk-images/Styles/Domination/Electrocute/Electrocute.png"},{"id":9,"name":"x","icon":"https://evil/x.png"}]}]}]"#,
        )
        .unwrap();
        assert_eq!(cat.champions[&62].key, "MonkeyKing");
        assert!(!cat.champions.contains_key(&1));
        assert_eq!(cat.items[&3089].gold, 3500);
        assert_eq!(cat.spells[&4].image, "SummonerFlash");
        assert_eq!(cat.runes[&8112].style, 8100);
        assert!(!cat.runes.contains_key(&9));
    }

    #[test]
    fn parses_and_validates_versions() {
        assert_eq!(first_version(r#"["15.21.1","15.20.1"]"#).unwrap(), "15.21.1");
        assert!(first_version(r#"["../evil"]"#).is_err());
        assert!(first_version(r#"["lolpatch_7.20"]"#).is_err());
        assert!(first_version("[]").is_err());
    }
}
