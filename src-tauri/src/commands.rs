//! Commandes IPC. Chaque commande :
//! - est declaree dans build.rs (permission `allow-<commande>`) et listee dans la capacite de la fenetre ;
//! - verifie la fenetre appelante (defense en profondeur) ;
//! - valide ses parametres en Rust, quelle que soit la validation faite dans React.

use crate::adapters::backend;
use crate::adapters::ddragon::{self, Catalog, StaticDataVersion};
use nex_domain::api::{MatchDto, MatchPageDto, PlayerProfileDto, TimelineDto};
use nex_domain::riot::{Platform, RiotId, validate_match_id, validate_puuid};
use crate::error::{AppError, AppResult};
use crate::persistence::{migrations, players, settings};
use crate::persistence::players::SavedPlayer;
use crate::persistence::settings::Settings;
use crate::state::AppState;
use serde::Serialize;
use tauri::{AppHandle, State, Window};
use tauri_plugin_opener::OpenerExt;

pub const MAIN_WINDOW: &str = "main";

fn require_main(window: &Window) -> AppResult<()> {
    if window.label() == MAIN_WINDOW {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Commandes partagees avec l'overlay (lecture seule ou disposition de ses widgets).
fn require_main_or_overlay(window: &Window) -> AppResult<()> {
    if window.label() == MAIN_WINDOW || window.label() == crate::overlay::LABEL {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub schema_version: i64,
    pub debug: bool,
}

#[tauri::command]
pub fn app_info(window: Window, state: State<'_, AppState>) -> AppResult<AppInfo> {
    require_main(&window)?;
    let schema_version = state.db.with(migrations::current_version)?;
    Ok(AppInfo {
        name: "NEX",
        version: env!("CARGO_PKG_VERSION"),
        schema_version,
        debug: cfg!(debug_assertions),
    })
}

#[tauri::command]
pub fn settings_get(window: Window, state: State<'_, AppState>) -> AppResult<Settings> {
    require_main_or_overlay(&window)?;
    state.db.with(settings::load)
}

#[tauri::command]
pub fn settings_set(
    window: Window,
    state: State<'_, AppState>,
    key: String,
    value: serde_json::Value,
) -> AppResult<Settings> {
    require_main(&window)?;
    if key.len() > 64 {
        return Err(AppError::InvalidInput("cle trop longue".into()));
    }
    state.db.with(|c| settings::set(c, &key, &value))
}

#[tauri::command]
pub fn favorites_list(window: Window, state: State<'_, AppState>) -> AppResult<Vec<SavedPlayer>> {
    require_main(&window)?;
    state.db.with(players::list_favorites)
}

#[tauri::command]
pub fn favorites_add(
    window: Window,
    state: State<'_, AppState>,
    riot_id: String,
    platform: String,
) -> AppResult<Vec<SavedPlayer>> {
    require_main(&window)?;
    let id = RiotId::parse(&riot_id)?;
    let platform = Platform::parse(&platform)?;
    state.db.with(|c| players::add_favorite(c, &id, platform))
}

#[tauri::command]
pub fn favorites_remove(window: Window, state: State<'_, AppState>, id: i64) -> AppResult<Vec<SavedPlayer>> {
    require_main(&window)?;
    state.db.with(|c| players::remove_favorite(c, id))
}

#[tauri::command]
pub fn recent_searches_list(window: Window, state: State<'_, AppState>) -> AppResult<Vec<SavedPlayer>> {
    require_main(&window)?;
    state.db.with(players::list_recent)
}

#[tauri::command]
pub fn recent_search_push(
    window: Window,
    state: State<'_, AppState>,
    riot_id: String,
    platform: String,
) -> AppResult<Vec<SavedPlayer>> {
    require_main(&window)?;
    let id = RiotId::parse(&riot_id)?;
    let platform = Platform::parse(&platform)?;
    state.db.with(|c| players::push_recent(c, &id, platform))
}

#[tauri::command]
pub fn recent_searches_clear(window: Window, state: State<'_, AppState>) -> AppResult<()> {
    require_main(&window)?;
    state.db.with(players::clear_recent)
}

#[tauri::command]
pub async fn static_data_version(window: Window, state: State<'_, AppState>) -> AppResult<StaticDataVersion> {
    require_main_or_overlay(&window)?;
    ddragon::latest_version(&state.db, &state.http).await
}

#[tauri::command]
pub async fn static_catalog(window: Window, state: State<'_, AppState>) -> AppResult<Catalog> {
    require_main_or_overlay(&window)?;
    let version = ddragon::latest_version(&state.db, &state.http).await?.version;
    let lang = if state.db.with(settings::load)?.language == "en" { "en_US" } else { "fr_FR" };
    ddragon::catalog(&state.db, &state.http, &version, lang).await
}

// ---------- Backend NEX ----------

fn backend_url(state: &AppState) -> AppResult<String> {
    Ok(state.db.with(settings::load)?.backend_url)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub url: String,
    pub reachable: bool,
    pub riot_key_configured: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn backend_health(window: Window, state: State<'_, AppState>) -> AppResult<BackendStatus> {
    require_main(&window)?;
    let url = backend_url(&state)?;
    Ok(match backend::health(&state.http, &url).await {
        Ok(h) => BackendStatus {
            url,
            reachable: true,
            riot_key_configured: h.riot_key_configured,
            version: Some(h.version),
            error: None,
        },
        Err(e) => BackendStatus { url, reachable: false, riot_key_configured: false, version: None, error: Some(e.to_string()) },
    })
}

#[tauri::command]
pub async fn player_profile(
    window: Window,
    state: State<'_, AppState>,
    riot_id: String,
    platform: String,
    refresh: Option<bool>,
) -> AppResult<PlayerProfileDto> {
    require_main(&window)?;
    let id = RiotId::parse(&riot_id)?;
    let platform = Platform::parse(&platform)?;
    let url = backend_url(&state)?;
    backend::player(&state.http, &url, platform.code(), &id.game_name, &id.tag_line, refresh.unwrap_or(false)).await
}

#[tauri::command]
pub async fn player_matches(
    window: Window,
    state: State<'_, AppState>,
    platform: String,
    puuid: String,
    start: Option<u32>,
    count: Option<u32>,
    queue: Option<u32>,
    timelines: Option<u32>,
) -> AppResult<MatchPageDto> {
    require_main(&window)?;
    let platform = Platform::parse(&platform)?;
    validate_puuid(&puuid)?;
    let start = start.unwrap_or(0);
    if start > 1000 {
        return Err(AppError::InvalidInput("pagination hors limites".into()));
    }
    let count = count.unwrap_or(10).clamp(1, 20);
    let timelines = timelines.unwrap_or(0).min(10);
    let url = backend_url(&state)?;
    backend::matches(&state.http, &url, platform.code(), &puuid, start, count, queue, timelines).await
}

#[tauri::command]
pub async fn match_get(window: Window, state: State<'_, AppState>, platform: String, match_id: String) -> AppResult<MatchDto> {
    require_main(&window)?;
    let platform = Platform::parse(&platform)?;
    validate_match_id(&match_id)?;
    let url = backend_url(&state)?;
    backend::match_one(&state.http, &url, platform.code(), &match_id).await
}

#[tauri::command]
pub async fn match_timeline(
    window: Window,
    state: State<'_, AppState>,
    platform: String,
    match_id: String,
) -> AppResult<TimelineDto> {
    require_main(&window)?;
    let platform = Platform::parse(&platform)?;
    validate_match_id(&match_id)?;
    let url = backend_url(&state)?;
    backend::timeline(&state.db, &state.http, &url, platform.code(), &match_id).await
}

// ---------- Statistiques agregees et fiche champion (etape 3) ----------

fn champion_param(id: i32) -> AppResult<i32> {
    if (1..=10_000).contains(&id) { Ok(id) } else { Err(AppError::InvalidInput("identifiant de champion invalide".into())) }
}

#[tauri::command]
pub async fn stats_meta(window: Window, state: State<'_, AppState>) -> AppResult<nex_domain::api::StatsMetaDto> {
    require_main(&window)?;
    backend::stats_meta(&state.http, &backend_url(&state)?).await
}

#[tauri::command]
pub async fn stats_tierlist(window: Window, state: State<'_, AppState>, params: backend::StatsParams) -> AppResult<nex_domain::api::TierListDto> {
    require_main(&window)?;
    params.validate()?;
    backend::stats_tierlist(&state.http, &backend_url(&state)?, &params).await
}

/// Medianes des mesures du Data Studio, sur les parties collectees par le backend.
#[tauri::command]
pub async fn stats_baselines(window: Window, state: State<'_, AppState>, params: backend::StatsParams) -> AppResult<nex_domain::api::BaselinesDto> {
    require_main(&window)?;
    params.validate()?;
    backend::stats_baselines(&state.http, &backend_url(&state)?, &params).await
}

#[tauri::command]
pub async fn stats_build(
    window: Window,
    state: State<'_, AppState>,
    champion_id: i32,
    params: backend::StatsParams,
) -> AppResult<nex_domain::api::ChampionBuildDto> {
    require_main_or_overlay(&window)?;
    params.validate()?;
    backend::stats_build(&state.http, &backend_url(&state)?, champion_param(champion_id)?, &params).await
}

#[tauri::command]
pub async fn stats_matchups(
    window: Window,
    state: State<'_, AppState>,
    champion_id: i32,
    params: backend::StatsParams,
) -> AppResult<nex_domain::api::MatchupsDto> {
    require_main(&window)?;
    params.validate()?;
    backend::stats_matchups(&state.http, &backend_url(&state)?, champion_param(champion_id)?, &params).await
}

#[tauri::command]
pub async fn champion_info(window: Window, state: State<'_, AppState>, key: String) -> AppResult<ddragon::ChampionInfo> {
    require_main(&window)?;
    let version = ddragon::latest_version(&state.db, &state.http).await?.version;
    let lang = if state.db.with(settings::load)?.language == "en" { "en_US" } else { "fr_FR" };
    ddragon::champion_info(&state.db, &state.http, &version, lang, &key).await
}

// ---------- Client local, partie en direct, overlay (etape 4) ----------

use crate::client::imports::{self, ImportOutcome, ItemSetInput, RunePageInput};
use crate::client::model::{ChampSelectState, ClientState, LiveSnapshot};
use crate::client::service::ClientService;
use crate::persistence::overlay::{self as overlay_layout, WidgetLayout};

#[tauri::command]
pub fn client_state(window: Window, svc: State<'_, ClientService>) -> AppResult<ClientState> {
    require_main(&window)?;
    svc.state.lock().map(|s| s.clone()).map_err(|_| AppError::Unavailable("état indisponible".into()))
}

#[tauri::command]
pub fn client_champ_select(window: Window, svc: State<'_, ClientService>) -> AppResult<Option<ChampSelectState>> {
    require_main(&window)?;
    svc.champ_select.lock().map(|s| s.clone()).map_err(|_| AppError::Unavailable("état indisponible".into()))
}

#[tauri::command]
pub fn live_snapshot(window: Window, svc: State<'_, ClientService>) -> AppResult<Option<LiveSnapshot>> {
    require_main_or_overlay(&window)?;
    svc.live.lock().map(|s| s.clone()).map_err(|_| AppError::Unavailable("état indisponible".into()))
}

fn connected_lcu(svc: &ClientService) -> AppResult<crate::adapters::lcu::Lcu> {
    svc.lcu().ok_or_else(|| AppError::Unavailable("client League non connecté : lance le client puis réessaie".into()))
}

#[tauri::command]
pub async fn lcu_import_runes(window: Window, svc: State<'_, ClientService>, input: RunePageInput) -> AppResult<ImportOutcome> {
    require_main(&window)?;
    let lcu = connected_lcu(&svc)?;
    imports::import_runes(&lcu, &input).await
}

#[tauri::command]
pub async fn lcu_import_items(window: Window, svc: State<'_, ClientService>, input: ItemSetInput) -> AppResult<ImportOutcome> {
    require_main(&window)?;
    let lcu = connected_lcu(&svc)?;
    imports::import_items(&lcu, &input).await
}

#[tauri::command]
pub fn overlay_open(window: Window, app: AppHandle, config: bool) -> AppResult<()> {
    require_main(&window)?;
    crate::overlay::open(&app, config)
}

#[tauri::command]
pub fn overlay_close(window: Window, app: AppHandle) -> AppResult<()> {
    require_main(&window)?;
    crate::overlay::close(&app);
    Ok(())
}

#[tauri::command]
pub fn overlay_set_mode(window: Window, app: AppHandle, config: bool) -> AppResult<()> {
    require_main_or_overlay(&window)?;
    crate::overlay::set_mode(&app, config)
}

#[tauri::command]
pub fn overlay_mode(window: Window) -> AppResult<bool> {
    require_main_or_overlay(&window)?;
    Ok(crate::overlay::CONFIG_MODE.load(std::sync::atomic::Ordering::SeqCst))
}

#[tauri::command]
pub fn overlay_layout_get(window: Window, state: State<'_, AppState>) -> AppResult<Vec<WidgetLayout>> {
    require_main_or_overlay(&window)?;
    state.db.with(overlay_layout::load)
}

#[tauri::command]
pub fn overlay_layout_set(window: Window, app: AppHandle, state: State<'_, AppState>, widget: WidgetLayout) -> AppResult<Vec<WidgetLayout>> {
    require_main_or_overlay(&window)?;
    let all = state.db.with(|c| overlay_layout::save(c, &widget))?;
    let _ = tauri::Emitter::emit(&app, "overlay://layout", &all);
    Ok(all)
}

#[tauri::command]
pub fn overlay_layout_reset(window: Window, app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<WidgetLayout>> {
    require_main(&window)?;
    let all = state.db.with(overlay_layout::reset)?;
    let _ = tauri::Emitter::emit(&app, "overlay://layout", &all);
    Ok(all)
}

// ---------- Capture et enregistrements (etape 5) ----------

use crate::capture::service::{self as capsvc, CaptureService, CaptureStatus, GameInfo, Source};
use crate::persistence::recordings::{self, Recording};
use std::sync::Arc;
use tauri::Manager;

fn free_bytes(dir: &std::path::Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list().ok()?;
    disks.iter().filter(|d| dir.starts_with(d.mount_point())).max_by_key(|d| d.mount_point().as_os_str().len()).map(|d| d.available_space())
}

#[tauri::command]
pub fn capture_status(window: Window, cap: State<'_, Arc<CaptureService>>) -> AppResult<CaptureStatus> {
    require_main(&window)?;
    Ok(cap.status())
}

/// Fenetres capturables (titre visible), pour le choix de la source.
#[tauri::command]
pub fn capture_sources(window: Window) -> AppResult<Vec<String>> {
    require_main(&window)?;
    let mut titles: Vec<String> = windows_capture::window::Window::enumerate()
        .map(|ws| ws.into_iter().filter_map(|w| w.title().ok()).filter(|t| !t.trim().is_empty() && t.len() <= 200).collect())
        .unwrap_or_default();
    titles.sort();
    titles.dedup();
    titles.truncate(80);
    Ok(titles)
}

#[tauri::command]
pub fn capture_start(window: Window, app: AppHandle, cap: State<'_, Arc<CaptureService>>, source: String, keep_all: bool) -> AppResult<CaptureStatus> {
    require_main(&window)?;
    let src = match source.as_str() {
        "game" => Source::GameWindow,
        "monitor" => Source::PrimaryMonitor,
        s if s.starts_with("window:") && s.len() <= 210 && !s[7..].trim().is_empty() => Source::Window(s[7..].to_string()),
        _ => return Err(AppError::InvalidInput("source de capture inconnue".into())),
    };
    cap.start(&app, src, keep_all, GameInfo::default())?;
    Ok(cap.status())
}

#[tauri::command]
pub fn capture_stop(window: Window, app: AppHandle, cap: State<'_, Arc<CaptureService>>) -> AppResult<()> {
    require_main(&window)?;
    cap.inner().stop(&app)
}

#[tauri::command]
pub async fn capture_save_clip(window: Window, app: AppHandle, seconds: u32, title: Option<String>) -> AppResult<Recording> {
    require_main(&window)?;
    if !(10..=600).contains(&seconds) {
        return Err(AppError::InvalidInput("durée de clip entre 10 et 600 s".into()));
    }
    let title = title.map(|t| t.chars().filter(|c| !c.is_control()).take(60).collect::<String>()).filter(|t| !t.trim().is_empty());
    let cap = app.state::<Arc<CaptureService>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || cap.save_clip(&app, seconds, title))
        .await
        .map_err(|e| AppError::Unavailable(e.to_string()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub dir: String,
    pub used_bytes: i64,
    pub quota_bytes: i64,
    pub free_bytes: Option<u64>,
    pub count: usize,
}

#[tauri::command]
pub fn recordings_list(window: Window, state: State<'_, AppState>) -> AppResult<Vec<Recording>> {
    require_main(&window)?;
    state.db.with(recordings::list)
}

#[tauri::command]
pub fn recordings_storage(window: Window, app: AppHandle, state: State<'_, AppState>) -> AppResult<StorageInfo> {
    require_main(&window)?;
    let dir = capsvc::base_dir(&app)?;
    let st = state.db.with(settings::load)?;
    let list = state.db.with(recordings::list)?;
    let free = free_bytes(&dir);
    Ok(StorageInfo {
        dir: dir.to_string_lossy().into_owned(),
        used_bytes: list.iter().map(|r| r.size_bytes).sum(),
        quota_bytes: st.storage_quota_gib as i64 * 1024 * 1024 * 1024,
        free_bytes: free,
        count: list.len(),
    })
}

#[tauri::command]
pub fn recording_set_favorite(window: Window, state: State<'_, AppState>, id: i64, favorite: bool) -> AppResult<Recording> {
    require_main(&window)?;
    state.db.with(|c| recordings::set_favorite(c, id, favorite))?.ok_or_else(|| AppError::NotFound("enregistrement introuvable".into()))
}

/// Verifie qu'un chemin d'index se trouve bien dans le dossier NEX (protection contre une base modifiee).
fn inside_nex(app: &AppHandle, path: &str) -> AppResult<std::path::PathBuf> {
    let base = capsvc::base_dir(app)?;
    let p = std::path::PathBuf::from(path);
    let canon_base = base.canonicalize().unwrap_or(base);
    let canon = p.canonicalize().map_err(|_| AppError::NotFound("fichier introuvable".into()))?;
    if canon.starts_with(&canon_base) { Ok(canon) } else { Err(AppError::Forbidden) }
}

/// Supprime un enregistrement : fichiers deplaces dans la Corbeille (recuperables), ligne retiree.
#[tauri::command]
pub fn recording_delete(window: Window, app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    require_main(&window)?;
    let rec = state.db.with(|c| recordings::get(c, id))?.ok_or_else(|| AppError::NotFound("enregistrement introuvable".into()))?;
    for p in std::iter::once(Some(rec.path.clone())).chain(std::iter::once(rec.thumb.clone())).flatten() {
        if let Ok(path) = inside_nex(&app, &p) {
            trash::delete(&path).map_err(|e| AppError::Storage(format!("mise à la corbeille : {e}")))?;
        }
    }
    state.db.with(|c| recordings::remove(c, id))?;
    let _ = tauri::Emitter::emit(&app, "recordings://changed", ());
    Ok(())
}

/// « Exporter » : ouvre l'Explorateur sur le fichier (copie libre par le joueur).
#[tauri::command]
pub fn recording_reveal(window: Window, app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    require_main(&window)?;
    let rec = state.db.with(|c| recordings::get(c, id))?.ok_or_else(|| AppError::NotFound("enregistrement introuvable".into()))?;
    let path = inside_nex(&app, &rec.path)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| AppError::Unavailable(e.to_string()))
}

// ---------- Collection, classements, spectate (etape 6) ----------

#[tauri::command]
pub async fn skin_catalog(window: Window, state: State<'_, AppState>) -> AppResult<crate::adapters::cdragon::SkinCatalog> {
    require_main(&window)?;
    let lang = state.db.with(settings::load)?.language;
    crate::adapters::cdragon::catalog(&state.db, &state.http, &lang).await
}

#[tauri::command]
pub async fn skin_inventory(window: Window, state: State<'_, AppState>, svc: State<'_, ClientService>) -> AppResult<crate::client::collection::SkinInventory> {
    require_main(&window)?;
    crate::client::collection::inventory(&state.db, svc.lcu()).await
}

#[tauri::command]
pub async fn leaderboard_get(window: Window, state: State<'_, AppState>, platform: String, queue: String, tier: String, page: u32) -> AppResult<nex_domain::api::LeaderboardDto> {
    require_main(&window)?;
    let platform = Platform::parse(&platform)?;
    if !["RANKED_SOLO_5x5", "RANKED_FLEX_SR"].contains(&queue.as_str()) || !["CHALLENGER", "GRANDMASTER", "MASTER"].contains(&tier.as_str()) || !(1..=400).contains(&page) {
        return Err(AppError::InvalidInput("paramètres de classement invalides".into()));
    }
    backend::leaderboard(&state.http, &backend_url(&state)?, platform.code(), &queue, &tier, page).await
}

/// Equipes professionnelles et comptes declares (Leaguepedia, via le backend).
#[tauri::command]
pub async fn pro_teams(window: Window, state: State<'_, AppState>) -> AppResult<nex_domain::api::ProTeamsDto> {
    require_main(&window)?;
    backend::pro_teams(&state.http, &backend_url(&state)?).await
}

/// Historique des LP observe par le backend. `queue` vide = toutes les files classees.
#[tauri::command]
pub async fn rank_history(window: Window, state: State<'_, AppState>, platform: String, puuid: String, queue: String) -> AppResult<Vec<nex_domain::api::RankSnapshotDto>> {
    require_main(&window)?;
    let platform = Platform::parse(&platform)?;
    validate_puuid(&puuid)?;
    if !["", "RANKED_SOLO_5x5", "RANKED_FLEX_SR"].contains(&queue.as_str()) {
        return Err(AppError::InvalidInput("file de classement inconnue".into()));
    }
    backend::rank_history(&state.http, &backend_url(&state)?, platform.code(), &puuid, &queue).await
}

#[tauri::command]
pub async fn live_game_get(window: Window, state: State<'_, AppState>, platform: String, puuid: String) -> AppResult<nex_domain::api::LiveGameDto> {
    require_main(&window)?;
    let platform = Platform::parse(&platform)?;
    validate_puuid(&puuid)?;
    backend::live_game(&state.http, &backend_url(&state)?, platform.code(), &puuid).await
}

/// Mode spectateur du client (declenche par le joueur).
#[tauri::command]
pub async fn lcu_spectate(window: Window, svc: State<'_, ClientService>, riot_id: String) -> AppResult<()> {
    require_main(&window)?;
    let id = RiotId::parse(&riot_id)?;
    let lcu = connected_lcu(&svc)?;
    crate::client::spectate::launch(&lcu, &id).await
}

/// Riot ID des amis dont la partie peut etre regardee depuis le client.
#[tauri::command]
pub async fn lcu_observable_friends(window: Window, svc: State<'_, ClientService>) -> AppResult<Vec<String>> {
    require_main(&window)?;
    let lcu = connected_lcu(&svc)?;
    crate::client::spectate::observable_friends(&lcu).await
}

/// Parties ARAM Mayhem du compte connecte au client. L'API publique de Riot ne les fournit
/// pas (403) : seule source, l'historique local du client. Liste vide si `riot_id` n'est pas
/// le compte du client.
#[tauri::command]
pub async fn lcu_match_history(
    window: Window,
    state: State<'_, AppState>,
    svc: State<'_, ClientService>,
    riot_id: String,
    puuid: String,
    count: Option<u32>,
) -> AppResult<Vec<MatchDto>> {
    require_main(&window)?;
    let id = RiotId::parse(&riot_id)?;
    validate_puuid(&puuid)?;
    let count = count.unwrap_or(20).clamp(1, 40) as usize;
    let lcu = connected_lcu(&svc)?;
    // Cles Data Dragon des champions (independantes de la langue).
    let version = ddragon::latest_version(&state.db, &state.http).await?.version;
    let lang = if state.db.with(settings::load)?.language == "en" { "en_US" } else { "fr_FR" };
    let catalog = ddragon::catalog(&state.db, &state.http, &version, lang).await?;
    let keys: std::collections::HashMap<i32, String> = catalog.champions.iter().map(|(id, c)| (*id, c.key.clone())).collect();
    crate::client::history::mayhem_matches(&lcu, &state.db, &id, &puuid, count, &keys).await
}

// ---------- Assistant ARAM Mayhem ----------

use crate::mayhem::{data as mayhem_data, service::{CardsEvent, MayhemService}};
use nex_mayhem::rules::{AugmentRule, Orientation, RuleSet};
use nex_mayhem::{ChampionProfile, MayhemCatalog};

fn valid_augment_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 80 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn check_keys<'a>(keys: impl IntoIterator<Item = &'a String>, max: usize) -> AppResult<()> {
    let mut n = 0;
    for k in keys {
        n += 1;
        if n > max || !valid_augment_key(k) {
            return Err(AppError::InvalidInput("identifiant d'augment invalide ou liste trop longue".into()));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mayhem_catalog(window: Window, state: State<'_, AppState>) -> AppResult<MayhemCatalog> {
    require_main(&window)?;
    mayhem_data::catalog(&state.db, &state.http).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MayhemRulesInfo {
    editorial: RuleSet,
    local: Vec<AugmentRule>,
}

#[tauri::command]
pub fn mayhem_rules(window: Window, state: State<'_, AppState>) -> AppResult<MayhemRulesInfo> {
    require_main(&window)?;
    Ok(MayhemRulesInfo {
        editorial: RuleSet::parse(nex_mayhem::rules::EDITORIAL_RULES).map_err(AppError::Unavailable)?,
        local: mayhem_data::local_rules(&state.db)?,
    })
}

#[tauri::command]
pub fn mayhem_save_rule(window: Window, state: State<'_, AppState>, rule: AugmentRule) -> AppResult<Vec<AugmentRule>> {
    require_main(&window)?;
    mayhem_data::save_local_rule(&state.db, &rule)
}

#[tauri::command]
pub fn mayhem_delete_rule(window: Window, state: State<'_, AppState>, key: String) -> AppResult<Vec<AugmentRule>> {
    require_main(&window)?;
    if !valid_augment_key(&key) {
        return Err(AppError::InvalidInput("identifiant d'augment invalide".into()));
    }
    mayhem_data::delete_local_rule(&state.db, &key)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MayhemRateRequest {
    /// Cle Data Dragon du champion (ex. `Ezreal`).
    champion: Option<String>,
    offered: Vec<Option<String>>,
    #[serde(default)]
    confirmed: Vec<String>,
    orientation: Option<Orientation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MayhemRateResult {
    ratings: Vec<nex_mayhem::Rating>,
    best: Option<usize>,
    profile: Option<ChampionProfile>,
    rules_version: String,
    /// Contexte par carte (popularite, combos documentes) : affiche, jamais utilise pour la note.
    context: Vec<nex_mayhem::provider::CardContext>,
}

/// Notes dans un contexte simule (page Augments, mode manuel). Regles de production uniquement.
#[tauri::command]
pub async fn mayhem_rate(window: Window, state: State<'_, AppState>, req: MayhemRateRequest) -> AppResult<MayhemRateResult> {
    require_main(&window)?;
    check_keys(req.offered.iter().flatten(), 400)?;
    check_keys(&req.confirmed, 12)?;
    let catalog = mayhem_data::catalog(&state.db, &state.http).await?;
    let profile = match req.champion.as_deref().filter(|c| !c.is_empty()) {
        Some(key) => {
            let version = ddragon::latest_version(&state.db, &state.http).await?.version;
            Some(mayhem_data::profile(&state.db, &state.http, &version, key).await?)
        }
        None => None,
    };
    let rules = mayhem_data::production_rules(&state.db)?;
    // Contexte uniquement pour les comparaisons courtes (pas pour la notation du catalogue entier).
    let dataset = if req.offered.len() <= 6 { mayhem_data::dataset(&state.db, &state.http, &catalog).await.ok() } else { None };
    let keys: Vec<Option<&str>> = req.offered.iter().map(|o| o.as_deref()).collect();
    let context = keys.iter().map(|k| nex_mayhem::provider::card_context(dataset.as_ref(), req.champion.as_deref(), *k, &req.confirmed)).collect();
    let ctx = nex_mayhem::Context { champion: profile.as_ref(), items: Default::default(), confirmed: req.confirmed, orientation: req.orientation };
    let ratings = nex_mayhem::rate(&rules, Some(&catalog), &ctx, &keys);
    Ok(MayhemRateResult { best: nex_mayhem::best_affinity(&ratings), ratings, profile, rules_version: rules.version, context })
}

/// Saisie manuelle des cartes (depannage) : affichee sur l'overlay, marquee « saisie manuelle ».
#[tauri::command]
pub fn mayhem_manual(window: Window, app: AppHandle, svc: State<'_, Arc<MayhemService>>, offered: Vec<Option<String>>) -> AppResult<Option<CardsEvent>> {
    require_main(&window)?;
    if offered.is_empty() || offered.len() > 6 {
        return Err(AppError::InvalidInput("de 1 à 6 cartes".into()));
    }
    check_keys(offered.iter().flatten(), 6)?;
    svc.manual(&app, &offered, false)
}

/// Apercu de demonstration (configuration) : donnees d'essai clairement marquees « DEMO ».
#[tauri::command]
pub fn mayhem_demo(window: Window, app: AppHandle, svc: State<'_, Arc<MayhemService>>, on: bool) -> AppResult<Option<CardsEvent>> {
    require_main(&window)?;
    if !on {
        svc.clear(&app);
        return Ok(None);
    }
    let keys = ["ARAM_Firebrand", "StillHere", "ARAM_OkBoomerang"].map(|k| Some(k.to_string()));
    svc.manual(&app, &keys, true)
}

#[tauri::command]
pub fn mayhem_clear(window: Window, app: AppHandle, svc: State<'_, Arc<MayhemService>>) -> AppResult<()> {
    require_main(&window)?;
    svc.clear(&app);
    Ok(())
}

/// Augment choisi confirme par le joueur (ou annule) : seule source des augments possedes.
#[tauri::command]
pub fn mayhem_confirm(window: Window, app: AppHandle, svc: State<'_, Arc<MayhemService>>, key: String, chosen: bool) -> AppResult<Vec<String>> {
    require_main(&window)?;
    if !valid_augment_key(&key) {
        return Err(AppError::InvalidInput("identifiant d'augment invalide".into()));
    }
    Ok(svc.confirm(&app, &key, chosen))
}

#[tauri::command]
pub fn mayhem_confirmed(window: Window, svc: State<'_, Arc<MayhemService>>) -> AppResult<Vec<String>> {
    require_main(&window)?;
    Ok(svc.confirmed())
}

/// Lecture des cartes demandee depuis l'interface (equivalent du raccourci Ctrl+Alt+A).
#[tauri::command]
pub fn mayhem_read_now(window: Window, app: AppHandle, svc: State<'_, Arc<MayhemService>>) -> AppResult<()> {
    require_main(&window)?;
    svc.start_session(&app, crate::mayhem::service::SESSION_HOTKEY);
    Ok(())
}

/// Donnees publiques arammayhem.com (CC BY 4.0) : popularite et combos, avec provenance,
/// capacites declarees et ecarts detectes. Aucun tier (non publie sous licence).
#[tauri::command]
pub async fn mayhem_dataset(window: Window, state: State<'_, AppState>) -> AppResult<nex_mayhem::provider::Dataset> {
    require_main(&window)?;
    let catalog = mayhem_data::catalog(&state.db, &state.http).await?;
    mayhem_data::dataset(&state.db, &state.http, &catalog).await
}

#[tauri::command]
pub fn mayhem_state(window: Window, svc: State<'_, Arc<MayhemService>>) -> AppResult<Option<CardsEvent>> {
    require_main_or_overlay(&window)?;
    Ok(svc.current())
}

/// Hotes que l'interface peut ouvrir dans le navigateur systeme. Tout le reste est refuse.
const EXTERNAL_HOSTS: &[&str] = &[
    "developer.riotgames.com",
    "www.riotgames.com",
    "www.leagueoflegends.com",
    "support-leagueoflegends.riotgames.com",
    "v2.tauri.app",
    // Attribution CC BY 4.0 des donnees ARAM Mayhem et liens vers les fiches de la source.
    "arammayhem.com",
    "creativecommons.org",
];

pub fn check_external_url(raw: &str) -> AppResult<reqwest::Url> {
    if raw.len() > 2048 {
        return Err(AppError::InvalidInput("URL trop longue".into()));
    }
    let url = reqwest::Url::parse(raw).map_err(|_| AppError::InvalidInput("URL invalide".into()))?;
    let host_ok = url.host_str().is_some_and(|h| EXTERNAL_HOSTS.contains(&h));
    if url.scheme() != "https" || !host_ok || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err(AppError::Forbidden);
    }
    Ok(url)
}

#[tauri::command]
pub fn open_external(window: Window, app: AppHandle, url: String) -> AppResult<()> {
    require_main(&window)?;
    let url = check_external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| AppError::Unavailable(format!("ouverture impossible : {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_allowlist() {
        assert!(check_external_url("https://developer.riotgames.com/apis").is_ok());
        assert!(check_external_url("http://developer.riotgames.com/").is_err());
        assert!(check_external_url("https://evil.example/").is_err());
        assert!(check_external_url("https://developer.riotgames.com.evil.example/").is_err());
        assert!(check_external_url("https://user@developer.riotgames.com/").is_err());
        assert!(check_external_url("https://developer.riotgames.com:8443/").is_err());
        assert!(check_external_url("file:///C:/Windows/System32/cmd.exe").is_err());
        assert!(check_external_url("javascript:alert(1)").is_err());
    }
}
