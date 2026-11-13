//! Equipes professionnelles et comptes classes de leurs joueurs, d'apres Leaguepedia
//! (lol.fandom.com, licence CC BY-SA 3.0). Lecture seule, avec un mot de passe robot
//! (LEAGUEPEDIA_USER / LEAGUEPEDIA_PASSWORD dans backend/.env) : l'API refuse les requetes
//! anonymes. Les identifiants ne sont jamais journalises ni renvoyes.
//!
//! Le champ `SoloqueueIds` est du texte saisi par des benevoles : seuls les Riot ID complets
//! (Pseudo#TAG) rattaches a une region connue sont retenus. La correspondance avec un compte
//! d'un classement se fait ensuite sur le Riot ID exact renvoye par Riot.

use crate::error::{BResult, BackendError};
use crate::routes::Shared;
use axum::Json;
use axum::extract::State;
use nex_domain::api::{ProAccountDto, ProPlayerDto, ProTeamDto, ProTeamsDto};
use nex_domain::riot::{Platform, RiotId};
use serde_json::Value;
use std::sync::OnceLock;

const API: &str = "https://lol.fandom.com/api.php";
const CACHE_KEY: &str = "pro:teams:v1";
const TTL_MS: i64 = 24 * 3600 * 1000;

/// Equipes affichees : (nom exact sur Leaguepedia, ligue).
pub const TEAMS: &[(&str, &str)] = &[
    ("T1", "LCK"),
    ("Gen.G", "LCK"),
    ("Karmine Corp", "LEC"),
    ("G2 Esports", "LEC"),
    ("Fnatic", "LEC"),
    ("Los Ratones", "ERL"),
];
const ROLES: &[&str] = &["Top", "Jungle", "Mid", "Bot", "Support"];

fn http() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("NEX-Backend/", env!("CARGO_PKG_VERSION"), " (Leaguepedia read-only)"))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("client HTTP")
    })
}

fn up(e: impl std::fmt::Display) -> BackendError {
    BackendError::Upstream(format!("Leaguepedia : {e}"))
}

/// URL de l'API avec ses parametres encodes.
fn api_url(params: &[(&str, &str)]) -> BResult<reqwest::Url> {
    reqwest::Url::parse_with_params(API, params).map_err(up)
}

/// Corps « application/x-www-form-urlencoded ».
fn form_body(params: &[(&str, &str)]) -> BResult<String> {
    Ok(reqwest::Url::parse_with_params("http://local/", params).map_err(up)?.query().unwrap_or("").to_string())
}

/// Region ecrite dans Leaguepedia -> plateforme Riot. Une region inconnue est ignoree.
fn platform_of(label: &str) -> Option<Platform> {
    let code = match label.trim().to_uppercase().as_str() {
        "EUW" => "EUW1",
        "EUNE" => "EUN1",
        "KR" | "KOREA" => "KR",
        "NA" => "NA1",
        "BR" => "BR1",
        "LAN" => "LA1",
        "LAS" => "LA2",
        "OCE" => "OC1",
        "TR" => "TR1",
        "JP" => "JP1",
        "VN" => "VN2",
        "TW" => "TW2",
        "SG" => "SG2",
        "ME" => "ME1",
        "RU" => "RU",
        _ => return None,
    };
    Platform::parse(code).ok()
}

/// Lit le texte `SoloqueueIds`. Format observe : `'''EUW:''' A#1, B#2 <br> '''KR:''' C#3`.
/// La region s'applique aux comptes qui suivent jusqu'a la suivante. Renvoie les comptes
/// exploitables et le nombre de comptes ignores.
pub fn parse_soloqueue_ids(raw: &str) -> (Vec<ProAccountDto>, u32) {
    let text = raw.replace("'''", "").replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n");
    let mut out: Vec<ProAccountDto> = Vec::new();
    let mut skipped = 0u32;
    let mut region: Option<Platform> = None;
    for line in text.lines() {
        let mut rest = line.trim();
        // Prefixe de region « EUW: » ou « KR : ».
        if let Some((head, tail)) = rest.split_once(':') {
            if head.len() <= 6 && head.chars().all(|c| c.is_ascii_alphabetic() || c == ' ') {
                region = platform_of(head);
                rest = tail.trim();
            }
        }
        for item in rest.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let item = item.trim_end_matches(|c: char| c == '.' || c == ';').trim();
            match (region, RiotId::parse(item)) {
                (Some(p), Ok(id)) => {
                    let riot_id = format!("{}#{}", id.game_name, id.tag_line);
                    if !out.iter().any(|a| a.platform == p.code() && a.riot_id.eq_ignore_ascii_case(&riot_id)) {
                        out.push(ProAccountDto { riot_id, platform: p.code().to_string() });
                    }
                }
                _ => skipped += 1,
            }
        }
    }
    (out, skipped)
}

/// Lit un identifiant dans backend/.env (deja charge dans l'environnement).
fn secret(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().trim_matches('"').to_string()).filter(|v| !v.is_empty())
}

/// Connexion par mot de passe robot ; renvoie l'en-tete Cookie de la session.
async fn login() -> BResult<String> {
    let (Some(user), Some(pass)) = (secret("LEAGUEPEDIA_USER"), secret("LEAGUEPEDIA_PASSWORD")) else {
        return Err(BackendError::Unavailable("Leaguepedia non configuré : ajoute LEAGUEPEDIA_USER et LEAGUEPEDIA_PASSWORD dans backend/.env".into()));
    };
    let r = http().get(api_url(&[("action", "query"), ("meta", "tokens"), ("type", "login"), ("format", "json")])?).send().await.map_err(up)?;
    let mut cookies: Vec<String> = r.headers().get_all(reqwest::header::SET_COOKIE).iter().filter_map(|v| v.to_str().ok()).map(|c| c.split(';').next().unwrap_or("").to_string()).collect();
    let v: Value = r.json().await.map_err(up)?;
    let token = v["query"]["tokens"]["logintoken"].as_str().ok_or_else(|| up("jeton de connexion absent"))?.to_string();
    let r = http()
        .post(API)
        .header(reqwest::header::COOKIE, cookies.join("; "))
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form_body(&[("action", "login"), ("lgname", user.as_str()), ("lgpassword", pass.as_str()), ("lgtoken", token.as_str()), ("format", "json")])?)
        .send()
        .await
        .map_err(up)?;
    cookies.extend(r.headers().get_all(reqwest::header::SET_COOKIE).iter().filter_map(|v| v.to_str().ok()).map(|c| c.split(';').next().unwrap_or("").to_string()));
    let v: Value = r.json().await.map_err(up)?;
    match v["login"]["result"].as_str() {
        Some("Success") => Ok(cookies.into_iter().filter(|c| !c.is_empty()).collect::<Vec<_>>().join("; ")),
        other => Err(BackendError::Unavailable(format!("connexion Leaguepedia refusée ({})", other.unwrap_or("réponse inattendue")))),
    }
}

async fn fetch() -> BResult<ProTeamsDto> {
    let cookie = login().await?;
    let names: Vec<String> = TEAMS.iter().map(|(n, _)| format!("\"{}\"", n.replace('"', ""))).collect();
    let roles: Vec<String> = ROLES.iter().map(|r| format!("\"{r}\"")).collect();
    let r#where = format!("Team IN ({}) AND Role IN ({}) AND (IsRetired IS NULL OR IsRetired=0)", names.join(","), roles.join(","));
    let url = api_url(&[
        ("action", "cargoquery"),
        ("format", "json"),
        ("limit", "200"),
        ("tables", "Players"),
        ("fields", "ID,Team,Role,Residency,SoloqueueIds,_pageName=Page"),
        ("where", r#where.as_str()),
    ])?;
    let r = http()
        .get(url)
        .header(reqwest::header::COOKIE, cookie)
        .send()
        .await
        .map_err(up)?;
    let v: Value = r.json().await.map_err(up)?;
    if let Some(e) = v.get("error") {
        return Err(up(e["info"].as_str().unwrap_or("erreur")));
    }
    let rows = v["cargoquery"].as_array().cloned().unwrap_or_default();
    let mut teams: Vec<ProTeamDto> = TEAMS.iter().map(|(n, l)| ProTeamDto { name: n.to_string(), league: l.to_string(), players: Vec::new() }).collect();
    for row in rows {
        let t = &row["title"];
        let s = |k: &str| t[k].as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(200).collect::<String>();
        let Some(team) = teams.iter_mut().find(|x| x.name == s("Team")) else { continue };
        let (accounts, unusable) = parse_soloqueue_ids(&s("SoloqueueIds"));
        let page = s("Page");
        team.players.push(ProPlayerDto {
            name: s("ID"),
            role: s("Role"),
            residency: s("Residency"),
            page_url: format!("https://lol.fandom.com/wiki/{}", page.replace(' ', "_")),
            accounts,
            unusable_accounts: unusable,
        });
    }
    for t in &mut teams {
        t.players.sort_by_key(|p| ROLES.iter().position(|r| *r == p.role).unwrap_or(9));
    }
    Ok(ProTeamsDto {
        source: "Leaguepedia".into(),
        source_url: "https://lol.fandom.com".into(),
        license: "CC BY-SA 3.0".into(),
        fetched_at: crate::store::now_ms(),
        teams,
    })
}

/// GET /v1/pro/teams : cache 24 h ; en cas d'echec, derniere collecte valide si elle existe.
pub async fn get_teams(State(s): State<Shared>) -> BResult<Json<ProTeamsDto>> {
    let store = s.riot.store();
    let cached = store.get(CACHE_KEY)?;
    if let Some(c) = &cached {
        if c.fresh {
            if let Ok(d) = serde_json::from_str(&c.body) {
                return Ok(Json(d));
            }
        }
    }
    match fetch().await {
        Ok(d) => {
            store.put(CACHE_KEY, &serde_json::to_string(&d)?, Some(TTL_MS))?;
            Ok(Json(d))
        }
        Err(e) => match cached.and_then(|c| serde_json::from_str(&c.body).ok()) {
            Some(d) => Ok(Json(d)),
            None => Err(e),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_real_leaguepedia_formats() {
        // Textes reels (Karmine Corp, 10 novembre 2026).
        let (a, skipped) = parse_soloqueue_ids("'''EUW:''' KC NEXT ADKING#EUW <br> I NEED SOLOQ#EUW <br> '''KR:''' KC Caliste#0001");
        assert_eq!(skipped, 0);
        assert_eq!(
            a.iter().map(|x| format!("{} {}", x.platform, x.riot_id)).collect::<Vec<_>>(),
            vec!["EUW1 KC NEXT ADKING#EUW", "EUW1 I NEED SOLOQ#EUW", "KR KC Caliste#0001"]
        );
        let (a, _) = parse_soloqueue_ids("'''EUW:''' basil#fan, OG Mithy#Moo <br> '''NA:''' Busio JNG#NA1 <br> '''KR:''' MADHATTER #HAT <br>");
        assert_eq!(a.len(), 4);
        assert_eq!((a[2].platform.as_str(), a[2].riot_id.as_str()), ("NA1", "Busio JNG#NA1"));
        let (a, _) = parse_soloqueue_ids("'''EUW:''' KC Yiken#1111 <br>'''KR''': YIK#YIK");
        assert_eq!(a.iter().map(|x| x.platform.as_str()).collect::<Vec<_>>(), vec!["EUW1", "KR"]);
    }

    #[test]
    fn ignores_what_cannot_be_verified() {
        // Anciens pseudos sans tag ni region : rien n'est retenu, tout est compte comme ignore.
        let (a, skipped) = parse_soloqueue_ids("SKT T1 Reapered, Azubu B Reapered, MiG FantasyStar");
        assert!(a.is_empty());
        assert_eq!(skipped, 3);
        // Region inconnue : ignore. Sans tag : ignore.
        let (a, skipped) = parse_soloqueue_ids("'''XYZ:''' Someone#123 <br> '''EUW:''' NoTag");
        assert!(a.is_empty());
        assert_eq!(skipped, 2);
        assert_eq!(parse_soloqueue_ids("").0.len(), 0);
    }
}
