//! Collecteur en tache de fond (desactive par defaut).
//!
//! Source : joueurs des ligues Challenger / Grand Maitre / Maitre (league-v4) des plateformes
//! configurees, leurs parties classees Solo/Duo recentes (match-v5) et, si active, les timelines.
//! Rythme volontairement lent (une requete Riot au plus toutes les `pace`), et priorite basse
//! dans le client Riot : il n'emet que si la reserve des visiteurs reste libre, et se tait
//! des qu'un visiteur essuie un refus de debit (voir `limiter`).

use crate::analytics;
use crate::error::{BResult, BackendError};
use crate::items::{self, ItemClasses};
use crate::limiter::Priority;
use crate::riot::{Freshness, RiotClient};
use crate::routes::AppState;
use nex_domain::api::{CollectorStatusDto, MatchDto, TimelineDto};
use nex_domain::riot::{Platform, validate_match_id, validate_puuid};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct CollectorConfig {
    pub enabled: bool,
    pub platforms: Vec<Platform>,
    pub pace: Duration,
    pub timelines: bool,
    /// Joueurs retenus par ligue (les mieux classes).
    pub players_per_tier: usize,
}

pub struct CollectorHandle {
    pub config: CollectorConfig,
    status: Mutex<(Option<i64>, Option<String>)>,
}

impl CollectorHandle {
    pub fn new(config: CollectorConfig) -> Arc<Self> {
        Arc::new(Self { config, status: Mutex::new((None, None)) })
    }

    pub fn status(&self, matches_total: u32) -> CollectorStatusDto {
        let (last, err) = self.status.lock().map(|g| g.clone()).unwrap_or((None, None));
        CollectorStatusDto {
            enabled: self.config.enabled,
            platforms: self.config.platforms.iter().map(|p| p.code().to_string()).collect(),
            matches_total,
            last_ingested_at: last,
            last_error: err,
        }
    }

    fn set_error(&self, e: Option<String>) {
        if let Ok(mut g) = self.status.lock() {
            g.1 = e;
        }
    }

    fn set_ingested(&self) {
        if let Ok(mut g) = self.status.lock() {
            g.0 = Some(crate::store::now_ms());
            g.1 = None;
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeagueList {
    #[serde(default)]
    entries: Vec<LeagueItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeagueItem {
    #[serde(default)]
    puuid: String,
    #[serde(default)]
    league_points: i32,
}

/// Les trois paliers du sommet ont chacun leur liste complete en un appel.
const LEAGUES: [(&str, &str); 3] = [
    ("CHALLENGER", "challengerleagues"),
    ("GRANDMASTER", "grandmasterleagues"),
    ("MASTER", "masterleagues"),
];

/// En dessous de Maitre il n'existe pas de liste : il faut demander division par division.
const TIERS_PAR_DIVISION: [&str; 7] = ["DIAMOND", "EMERALD", "PLATINUM", "GOLD", "SILVER", "BRONZE", "IRON"];
/// Les quatre divisions, et non la seule I : le haut d'un palier joue deja comme le palier
/// au-dessus, et echantillonner la I seule decrirait mal le palier qu'on pretend mesurer.
const DIVISIONS: [&str; 4] = ["I", "II", "III", "IV"];

/// GET du collecteur : rythme, priorite basse, et patience.
///
/// On ne dort que si la donnee n'est pas deja en cache. Avant d'emettre, on attend que la
/// reserve des visiteurs soit libre (`wait_background_slot`), hors du verrou de
/// deduplication. Un refus de debit n'est pas une erreur pour le collecteur : il laisse la
/// fenetre se vider et reessaie la meme requete, au lieu d'abandonner le joueur en cours.
async fn paced(s: &AppState, pace: Duration, key: &str, url: reqwest::Url, fresh: Freshness, transform: fn(String) -> BResult<String>) -> BResult<String> {
    let cached = s.riot.store().get(key)?.is_some_and(|c| c.fresh);
    if cached {
        return s.riot.get_cached_as(Priority::Background, key, url, fresh, false, transform).await;
    }
    let mut essais = 0;
    loop {
        essais += 1;
        tokio::time::sleep(pace).await;
        s.riot.wait_background_slot().await;
        match s.riot.get_cached_as(Priority::Background, key, url.clone(), fresh, false, transform).await {
            // Un visiteur est passe entre l'attente et l'envoi, ou Riot a dit stop : on
            // laisse la fenetre se vider et on reessaie, cinq fois au plus.
            Err(BackendError::RateLimited(secs)) if essais < 5 => {
                tracing::debug!(secs, essais, cle = %key, "collecteur : debit refuse, nouvel essai");
            }
            r => return r,
        }
    }
}

fn norm_match(raw: String) -> BResult<String> {
    Ok(serde_json::to_string(&crate::normalize::match_dto(&raw)?)?)
}
fn norm_timeline(raw: String) -> BResult<String> {
    Ok(serde_json::to_string(&crate::normalize::timeline_dto(&raw)?)?)
}

async fn seeds(s: &AppState, cfg: &CollectorConfig, platform: Platform) -> BResult<Vec<(String, &'static str)>> {
    let mut out = Vec::new();
    let host = platform.host();
    for (tier, endpoint) in LEAGUES {
        let url = RiotClient::url(&host, &["lol", "league", "v4", endpoint, "by-queue", "RANKED_SOLO_5x5"], &[])?;
        let key = format!("league-list:{host}:{endpoint}");
        let body = paced(s, cfg.pace, &key, url, Freshness::Ttl(Duration::from_secs(6 * 3600)), Ok).await?;
        let mut list: LeagueList = serde_json::from_str(&body)?;
        list.entries.retain(|e| validate_puuid(&e.puuid).is_ok());
        list.entries.sort_by_key(|e| std::cmp::Reverse(e.league_points));
        out.extend(list.entries.into_iter().take(cfg.players_per_tier).map(|e| (e.puuid, tier)));
    }
    for tier in TIERS_PAR_DIVISION {
        let par_division = (cfg.players_per_tier / DIVISIONS.len()).max(1);
        for division in DIVISIONS {
            let url = RiotClient::url(
                &host,
                &["lol", "league", "v4", "entries", "RANKED_SOLO_5x5", tier, division],
                &[("page", "1".into())],
            )?;
            let key = format!("league-entries:{host}:{tier}:{division}");
            let body = paced(s, cfg.pace, &key, url, Freshness::Ttl(Duration::from_secs(6 * 3600)), Ok).await?;
            // Reponse a plat, contrairement aux ligues du sommet qui emballent dans `entries`.
            let mut entries: Vec<LeagueItem> = serde_json::from_str(&body)?;
            entries.retain(|e| validate_puuid(&e.puuid).is_ok());
            // Pas de tri par LP ici : au sommet on veut les meilleurs, dans une division on
            // veut un echantillon representatif. Trier remonterait le haut de la division.
            entries.truncate(par_division);
            out.extend(entries.into_iter().map(|e| (e.puuid, tier)));
        }
    }
    Ok(alterner_les_paliers(out))
}

/// Alterne les paliers au lieu de les enchainer.
///
/// POURQUOI : a dix paliers et cent joueurs chacun, les cent joueurs de Fer arrivaient en
/// 901e position. Avec un appel espace de 2,5 s et les chronologies activees, le collecteur
/// met des heures a y parvenir — une session qui ne tourne pas la nuit entiere ne les
/// atteignait jamais, et le palier restait vide sans que rien ne l'explique. En alternant,
/// chaque palier avance au meme rythme et se remplit des la premiere heure.
fn alterner_les_paliers(joueurs: Vec<(String, &'static str)>) -> Vec<(String, &'static str)> {
    let mut files: Vec<(&'static str, Vec<String>)> = Vec::new();
    for (puuid, tier) in joueurs {
        match files.iter_mut().find(|(t, _)| *t == tier) {
            Some((_, f)) => f.push(puuid),
            None => files.push((tier, vec![puuid])),
        }
    }
    let plus_longue = files.iter().map(|(_, f)| f.len()).max().unwrap_or(0);
    let mut sortie = Vec::new();
    for i in 0..plus_longue {
        for (tier, f) in files.iter() {
            if let Some(p) = f.get(i) {
                sortie.push((p.clone(), *tier));
            }
        }
    }
    sortie
}

#[cfg(test)]
mod tests {
    use super::alterner_les_paliers;

    #[test]
    fn alterne_les_paliers_sans_perdre_personne() {
        let entree: Vec<(String, &'static str)> = [("a", "CHALLENGER"), ("b", "CHALLENGER"), ("c", "IRON"), ("d", "IRON"), ("e", "IRON")]
            .into_iter()
            .map(|(p, t)| (p.to_string(), t))
            .collect();
        let sortie = alterner_les_paliers(entree);
        assert_eq!(sortie.len(), 5, "aucun joueur ne doit disparaitre");
        // Fer n'attend plus la fin de Challenger : son premier joueur passe en 2e position.
        assert_eq!(sortie[0], ("a".into(), "CHALLENGER"));
        assert_eq!(sortie[1], ("c".into(), "IRON"));
        assert_eq!(sortie[2], ("b".into(), "CHALLENGER"));
        assert_eq!(sortie[3], ("d".into(), "IRON"));
        // La file la plus longue finit seule, sans trou.
        assert_eq!(sortie[4], ("e".into(), "IRON"));
    }

    #[test]
    fn alterne_supporte_une_liste_vide() {
        assert!(alterner_les_paliers(Vec::new()).is_empty());
    }
}

async fn collect_player(s: &AppState, cfg: &CollectorConfig, items: &ItemClasses, platform: Platform, puuid: &str, tier: &str) -> BResult<u32> {
    let region = platform.regional().host();
    let since = (crate::store::now_ms() / 1000 - 14 * 24 * 3600).to_string();
    let url = RiotClient::url(
        region,
        &["lol", "match", "v5", "matches", "by-puuid", puuid, "ids"],
        &[("queue", "420".into()), ("count", "10".into()), ("startTime", since)],
    )?;
    let body = paced(s, cfg.pace, &format!("collect-ids:{puuid}"), url, Freshness::Ttl(Duration::from_secs(1800)), Ok).await?;
    let ids: Vec<String> = serde_json::from_str(&body)?;
    let mut added = 0;
    for id in ids.iter().filter(|id| validate_match_id(id).is_ok()) {
        let known = s.riot.store().with(|c| {
            Ok(c.query_row("SELECT 1 FROM a_matches WHERE match_id = ?1", [id], |_| Ok(())).is_ok())
        })?;
        if known {
            continue;
        }
        let url = RiotClient::url(region, &["lol", "match", "v5", "matches", id], &[])?;
        let m: MatchDto = serde_json::from_str(&paced(s, cfg.pace, &format!("m:v{}:{id}", crate::normalize::NORMALIZE_VERSION), url, Freshness::Immutable, norm_match).await?)?;
        let t: Option<TimelineDto> = if cfg.timelines && !m.remake {
            let url = RiotClient::url(region, &["lol", "match", "v5", "matches", id, "timeline"], &[])?;
            let key = format!("tl:v{}:{id}", crate::normalize::NORMALIZE_VERSION);
            match paced(s, cfg.pace, &key, url, Freshness::Immutable, norm_timeline).await {
                Ok(b) => serde_json::from_str(&b).ok(),
                Err(BackendError::NotFound(_)) => None,
                Err(e) => return Err(e),
            }
        } else {
            None
        };
        if s.riot.store().with(|c| analytics::ingest(c, &m, t.as_ref(), tier, items))? {
            added += 1;
        }
    }
    Ok(added)
}

pub async fn run(state: Arc<AppState>, handle: Arc<CollectorHandle>, http: reqwest::Client) {
    let cfg = handle.config.clone();
    tracing::info!(platforms = ?cfg.platforms.iter().map(|p| p.code()).collect::<Vec<_>>(), pace_ms = cfg.pace.as_millis() as u64, "collecteur demarre");
    let mut items: Option<(ItemClasses, std::time::Instant)> = None;
    loop {
        if items.as_ref().is_none_or(|(_, at)| at.elapsed() > Duration::from_secs(12 * 3600)) {
            match items::fetch(&http).await {
                Ok(c) => items = Some((c, std::time::Instant::now())),
                Err(e) => {
                    handle.set_error(Some(format!("objets Data Dragon : {e}")));
                    tokio::time::sleep(Duration::from_secs(300)).await;
                    continue;
                }
            }
        }
        let classes = &items.as_ref().expect("objets charges").0;
        // Un tour ou aucune plateforme n'a livre ses joueurs n'est pas un tour complet :
        // `handle_error` a deja attendu, on recommence sans la pause de dix minutes.
        // POURQUOI : au demarrage, un seul refus de debit pendant les semences (31 appels,
        // 77 s a 2,5 s d'ecart) laissait le collecteur muet dix minutes, puis rejouait la
        // meme scene. Mesure du 15 novembre 2026 : 0 partie en 180 s, « limite de debit
        // Riot atteinte » en derniere erreur, total fige.
        let mut un_tour = false;
        for platform in &cfg.platforms {
            let players = match seeds(&state, &cfg, *platform).await {
                Ok(p) => p,
                Err(e) => {
                    handle_error(&handle, e).await;
                    continue;
                }
            };
            un_tour = true;
            for (puuid, tier) in players {
                match collect_player(&state, &cfg, classes, *platform, &puuid, tier).await {
                    Ok(n) if n > 0 => {
                        handle.set_ingested();
                        tracing::debug!(n, "parties ingerees");
                    }
                    Ok(_) => {}
                    Err(e) => handle_error(&handle, e).await,
                }
            }
        }
        // Tour complet termine : pause avant de recommencer.
        if un_tour {
            tokio::time::sleep(Duration::from_secs(600)).await;
        }
    }
}

async fn handle_error(handle: &CollectorHandle, e: BackendError) {
    let msg = e.to_string();
    tracing::warn!("collecteur : {msg}");
    handle.set_error(Some(msg));
    let wait = match e {
        BackendError::RateLimited(s) => Duration::from_secs(s.max(5)),
        BackendError::Unavailable(_) => Duration::from_secs(600),
        _ => Duration::from_secs(10),
    };
    tokio::time::sleep(wait).await;
}
