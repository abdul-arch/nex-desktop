//! Suivi du client League en tache de fond.
//!
//! Frequences (pas de polling a haute frequence) :
//! - client absent : recherche du lockfile toutes les 10 s ;
//! - accueil / salon / file : phase toutes les 4 s ;
//! - selection des champions : session toutes les 1,5 s ;
//! - partie en cours : Live Client Data toutes les 2 s (l'overlay interpole le chronometre).
//! Les evenements ne sont emis qu'en cas de changement. Tout est libere en fin de partie.

use super::model::{self, ChampSelectState, ClientState, LiveSnapshot, LocalSummoner};
use crate::adapters::lcu::{self, Lcu, paths};
use crate::capture::service::{CaptureService, GameInfo, Source};
use crate::overlay;
use crate::persistence::{now_secs, settings};
use crate::state::AppState;
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct ClientService {
    pub state: Mutex<ClientState>,
    pub champ_select: Mutex<Option<ChampSelectState>>,
    pub live: Mutex<Option<LiveSnapshot>>,
    pub lcu: Mutex<Option<Lcu>>,
}

impl ClientService {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(absent(None)),
            champ_select: Mutex::new(None),
            live: Mutex::new(None),
            lcu: Mutex::new(None),
        }
    }

    pub fn lcu(&self) -> Option<Lcu> {
        self.lcu.lock().ok().and_then(|g| g.clone())
    }
}

fn absent(error: Option<String>) -> ClientState {
    ClientState { status: "absent", stage: "absent", phase: String::new(), summoner: None, error, since: now_secs() }
}

fn set<T: PartialEq + Clone + serde::Serialize>(app: &AppHandle, slot: &Mutex<T>, value: T, event: &str) {
    let changed = match slot.lock() {
        Ok(mut g) => {
            if *g != value {
                *g = value.clone();
                true
            } else {
                false
            }
        }
        Err(_) => false,
    };
    if changed {
        // Diagnostic en developpement : nom de l'evenement seulement (aucune donnee joueur).
        #[cfg(debug_assertions)]
        eprintln!("[nex] evenement {event}");
        let _ = app.emit(event, value);
    }
}

async fn summoner(lcu: &Lcu) -> Option<LocalSummoner> {
    let s: Value = lcu.get(paths::SUMMONER).await.ok()?;
    let region: Option<Value> = lcu.get(paths::REGION).await.ok();
    Some(LocalSummoner {
        game_name: s.get("gameName").and_then(Value::as_str).unwrap_or("").to_string(),
        tag_line: s.get("tagLine").and_then(Value::as_str).unwrap_or("").to_string(),
        platform: region
            .as_ref()
            .and_then(|r| r.get("region"))
            .and_then(Value::as_str)
            .and_then(model::platform_of_region)
            .map(str::to_string),
        level: s.get("summonerLevel").and_then(Value::as_u64).unwrap_or(0) as u32,
    })
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let service = app.state::<ClientService>();
        let lcu_http = match lcu::pinned_client(Duration::from_secs(4)) {
            Ok(c) => c,
            Err(e) => {
                set(&app, &service.state, absent(Some(e.to_string())), "client://state");
                return;
            }
        };
        // Sans acces a la liste des processus, on se rabat sur les emplacements usuels.
        let mut sys = sysinfo::System::new().ok();
        let mut current_summoner: Option<LocalSummoner> = None;
        // Une seule tentative de capture automatique par partie (pas de boucle d'erreurs).
        let mut capture_tried = false;
        loop {
            // 1. Connexion : lockfile du client.
            let client = match service.lcu() {
                Some(c) => c,
                None => match lcu::find_install_dir(sys.as_mut()).and_then(|d| lcu::read_credentials(&d)) {
                    Some(creds) => {
                        let c = Lcu::new(lcu_http.clone(), creds);
                        if let Ok(mut g) = service.lcu.lock() {
                            *g = Some(c.clone());
                        }
                        current_summoner = None;
                        c
                    }
                    None => {
                        set(&app, &service.state, absent(None), "client://state");
                        tokio::time::sleep(Duration::from_secs(10)).await;
                        continue;
                    }
                },
            };

            // 2. Phase de jeu.
            let phase: String = match client.get(paths::PHASE).await {
                Ok(p) => p,
                Err(_) => {
                    // Client ferme ou redemarre : on oublie les identifiants.
                    if let Ok(mut g) = service.lcu.lock() {
                        *g = None;
                    }
                    set(&app, &service.champ_select, None, "client://champselect");
                    leave_game(&app, &service);
                    set(&app, &service.state, absent(None), "client://state");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };
            if current_summoner.is_none() {
                current_summoner = summoner(&client).await;
            }
            let stage = model::stage_of(&phase);
            #[cfg(debug_assertions)]
            if service.state.lock().map(|s| s.stage != stage).unwrap_or(false) {
                eprintln!("[nex] client connecte, etape {stage}");
            }
            let previous_stage = service.state.lock().map(|s| s.stage).unwrap_or("absent");
            let since = if previous_stage == stage { service.state.lock().map(|s| s.since).unwrap_or_else(|_| now_secs()) } else { now_secs() };
            set(
                &app,
                &service.state,
                ClientState { status: "connected", stage, phase: phase.clone(), summoner: current_summoner.clone(), error: None, since },
                "client://state",
            );

            // 3. Donnees selon l'etape.
            let wait = match stage {
                "champ_select" => {
                    if let Ok(session) = client.get::<Value>(paths::CHAMP_SELECT).await {
                        set(&app, &service.champ_select, Some(model::champ_select(&session)), "client://champselect");
                    }
                    Duration::from_millis(1500)
                }
                "loading" | "in_game" | "reconnect" => {
                    set(&app, &service.champ_select, None, "client://champselect");
                    match lcu::live_all(&lcu_http).await.ok().and_then(|v| model::live_snapshot(&v)) {
                        Some(snap) => {
                            if !overlay::is_open(&app) && auto_overlay(&app) {
                                let _ = overlay::open(&app, false);
                            }
                            capture_hook(&app, &snap, &mut capture_tried);
                            if let Some(m) = app.try_state::<std::sync::Arc<crate::mayhem::service::MayhemService>>() {
                                m.on_snapshot(&app, &snap);
                            }
                            set(&app, &service.live, Some(snap), "live://snapshot");
                        }
                        None => {}
                    }
                    Duration::from_secs(2)
                }
                _ => {
                    set(&app, &service.champ_select, None, "client://champselect");
                    leave_game(&app, &service);
                    capture_tried = false;
                    Duration::from_secs(4)
                }
            };
            tokio::time::sleep(wait).await;
        }
    });
}

fn auto_overlay(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|s| s.db.with(settings::load).ok())
        .is_some_and(|s| s.overlay_auto)
}

/// Capture en partie : demarrage automatique si le mode Capture est actif (mode Eco desactive),
/// mise a jour des moments forts (marqueurs, clips automatiques).
fn capture_hook(app: &AppHandle, snap: &model::LiveSnapshot, tried: &mut bool) {
    let Some(capture) = app.try_state::<std::sync::Arc<CaptureService>>() else { return };
    let st = app.try_state::<AppState>().and_then(|s| s.db.with(settings::load).ok()).unwrap_or_default();
    if !st.eco_mode && !capture.is_active() && !*tried {
        *tried = true;
        let me = snap.players.iter().find(|p| p.is_active);
        let game = GameInfo {
            champion_key: me.map(|p| p.champion_key.clone()).filter(|k| !k.is_empty()),
            game_mode: Some(snap.game_mode.clone()),
            game_time_at_start: Some(snap.game_time),
        };
        if let Err(e) = capture.start(app, Source::GameWindow, st.record_full_games, game) {
            eprintln!("capture automatique impossible : {e}");
        }
    }
    let kda = snap.players.iter().find(|p| p.is_active).map(|p| format!("{}/{}/{}", p.kills, p.deaths, p.assists));
    capture.on_live(app, &snap.highlights, kda, st.auto_clips);
}

/// Fin de partie : overlay detruit et instantane efface (sauf overlay ouvert en configuration).
/// Une capture demarree automatiquement sur la fenetre du jeu est arretee et finalisee.
fn leave_game(app: &AppHandle, service: &ClientService) {
    let had = service.live.lock().map(|g| g.is_some()).unwrap_or(false);
    if had {
        if let Some(capture) = app.try_state::<std::sync::Arc<CaptureService>>() {
            if capture.status().source.as_deref() == Some(crate::capture::service::GAME_WINDOW) {
                let _ = capture.inner().stop(app);
            }
        }
        set(app, &service.live, None, "live://snapshot");
        if !overlay::CONFIG_MODE.load(std::sync::atomic::Ordering::SeqCst) {
            overlay::close(app);
        }
        // Assistant Mayhem : badges retires, lecture arretee, partie oubliee.
        if let Some(m) = app.try_state::<std::sync::Arc<crate::mayhem::service::MayhemService>>() {
            m.on_leave(app);
        }
    }
}
