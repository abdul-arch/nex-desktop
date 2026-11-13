//! Noyau natif NEX.
//!
//! Couches : domaine partage (`nex-domain`) -> `persistence` (SQLite) / `adapters` (sources
//! externes : Data Dragon, backend NEX, client local) -> `client` (suivi du client League) ->
//! `commands` (IPC type, permissions par fenetre). Fenetres : `windows` (principale, zone de
//! notification, raccourcis) et `overlay`.

mod adapters;
mod capture;
mod client;
mod commands;
mod error;
mod mayhem;
mod overlay;
mod persistence;
mod state;
mod windows;

use persistence::Db;
use state::AppState;
use std::time::Duration;
use tauri::{Manager, RunEvent, WindowEvent};

fn capture_selftest_run(app: &tauri::AppHandle, title: String) {
    use capture::service::{CaptureService, GameInfo, Source};
    std::thread::sleep(Duration::from_secs(2));
    let cap = app.state::<std::sync::Arc<CaptureService>>().inner().clone();
    let t0 = std::time::Instant::now();
    if let Err(e) = cap.start(app, Source::Window(title), false, GameInfo::default()) {
        eprintln!("[selftest] demarrage impossible : {e}");
        return;
    }
    eprintln!("[selftest] capture demarree");
    std::thread::sleep(Duration::from_secs(20));
    eprintln!("[selftest] tampon avant clip : {:?}", cap.buffer_summary());
    match cap.save_clip(app, 15, Some("Test de capture".into())) {
        Ok(r) => {
            eprintln!("[selftest] clip {} : {} ms, {} octets, miniature {}", r.id, r.duration_ms, r.size_bytes, r.thumb.is_some());
            // Diagnostic : copie de la miniature (verification visuelle) avant le nettoyage.
            if let (Some(thumb), Ok(dest)) = (&r.thumb, std::env::var("NEX_SELFTEST_THUMB_COPY")) {
                let _ = std::fs::copy(thumb, dest);
            }
        }
        Err(e) => eprintln!("[selftest] clip impossible : {e}"),
    }
    eprintln!("[selftest] tampon apres clip : {:?}", cap.buffer_summary());
    let st = cap.status();
    eprintln!("[selftest] images {} abandonnees {} {}x{} tampon {} s / {} Mio", st.frames_sent, st.frames_dropped, st.width, st.height, st.buffered_seconds, st.buffered_mib);
    let _ = cap.stop(app);
    std::thread::sleep(Duration::from_secs(3));
    eprintln!("[selftest] termine en {:?}, erreur {:?}", t0.elapsed(), cap.status().error);
    // Nettoyage : l'auto-test ne laisse aucun clip dans la bibliotheque du joueur.
    let db = &app.state::<AppState>().db;
    if let Ok(list) = db.with(persistence::recordings::list) {
        for r in list.into_iter().filter(|r| r.title == "Test de capture") {
            let _ = std::fs::remove_file(&r.path);
            if let Some(t) = &r.thumb {
                let _ = std::fs::remove_file(t);
            }
            let _ = db.with(|c| persistence::recordings::remove(c, r.id));
            eprintln!("[selftest] clip de test {} supprime", r.id);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    // --tray : demarrer sans fenetre principale (mesures, demarrage avec Windows).
    let start_hidden = args.iter().any(|a| a == "--tray");
    // --overlay-preview : ouvrir l'overlay en mode configuration (apercu, mesures).
    let overlay_preview = args.iter().any(|a| a == "--overlay-preview");
    // --overlay-game : ouvrir l'overlay en mode jeu (traverse par les clics), pour les mesures.
    let overlay_game = args.iter().any(|a| a == "--overlay-game");
    // --capture-selftest=<titre> : capture 20 s de la fenetre indiquee, clip de 15 s, arret.
    // Diagnostic et mesures uniquement ; la fenetre doit etre designee explicitement.
    let capture_selftest = args.iter().find_map(|a| a.strip_prefix("--capture-selftest=").map(str::to_string));
    // --perf-tour=<s> : mesures. Apres 15 s, parcourt toutes les pages (s secondes chacune, 2 tours)
    // en faisant defiler le contenu. Lecture seule : aucune ecriture, aucun import.
    let perf_tour = args.iter().find_map(|a| a.strip_prefix("--perf-tour=")).and_then(|s| s.parse::<u64>().ok()).filter(|s| (2..=120).contains(s));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(windows::shortcuts_plugin())
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db = Db::open(&data_dir.join("nex.sqlite3"))?;
            db.with(persistence::cache::purge)?;

            let http = reqwest::Client::builder()
                .user_agent(concat!("NEX-Desktop/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(10))
                .connect_timeout(Duration::from_secs(5))
                .pool_max_idle_per_host(2)
                .build()?;

            app.manage(AppState { db, http });
            app.manage(client::service::ClientService::new());
            app.manage(std::sync::Arc::new(capture::service::CaptureService::default()));
            app.manage(std::sync::Arc::new(mayhem::service::MayhemService::default()));

            let handle = app.handle().clone();
            // Lecture video : protocole d'assets limite au seul dossier Videos\NEX.
            if let Ok(dir) = capture::service::base_dir(&handle) {
                let _ = std::fs::create_dir_all(&dir);
                let _ = handle.asset_protocol_scope().allow_directory(&dir, true);
            }
            // Sessions interrompues (arret brutal) : recuperees en arriere-plan.
            {
                let h = handle.clone();
                std::thread::spawn(move || capture::service::recover(&h));
            }
            windows::setup_tray(&handle)?;
            windows::register_shortcuts(&handle);
            if !start_hidden {
                windows::open_main(&handle)?;
            }
            if overlay_preview || overlay_game {
                overlay::open(&handle, overlay_preview)?;
            }
            if let Some(title) = capture_selftest.clone() {
                let h = handle.clone();
                std::thread::spawn(move || capture_selftest_run(&h, title));
            }
            if let Some(secs) = perf_tour {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(15));
                    let payload = serde_json::json!({ "dwellMs": secs * 1000, "rounds": 2 });
                    let _ = tauri::Emitter::emit_to(&h, windows::MAIN, "perf://tour", payload);
                    eprintln!("[perf] parcours demarre : {secs} s par page, 2 tours");
                });
            }
            client::service::spawn(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == windows::MAIN {
                if let WindowEvent::CloseRequested { .. } = event {
                    // Mode « Quitter » : fermer la fenetre principale termine tout NEX.
                    if !windows::tray_mode(window.app_handle()) {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::settings_get,
            commands::settings_set,
            commands::favorites_list,
            commands::favorites_add,
            commands::favorites_remove,
            commands::recent_searches_list,
            commands::recent_search_push,
            commands::recent_searches_clear,
            commands::static_data_version,
            commands::static_catalog,
            commands::open_external,
            commands::backend_health,
            commands::player_profile,
            commands::player_matches,
            commands::match_get,
            commands::match_timeline,
            commands::stats_meta,
            commands::stats_tierlist,
            commands::stats_build,
            commands::stats_matchups,
            commands::champion_info,
            commands::client_state,
            commands::client_champ_select,
            commands::live_snapshot,
            commands::lcu_import_runes,
            commands::lcu_import_items,
            commands::overlay_open,
            commands::overlay_close,
            commands::overlay_set_mode,
            commands::overlay_mode,
            commands::overlay_layout_get,
            commands::overlay_layout_set,
            commands::overlay_layout_reset,
            commands::capture_status,
            commands::capture_sources,
            commands::capture_start,
            commands::capture_stop,
            commands::capture_save_clip,
            commands::recordings_list,
            commands::recordings_storage,
            commands::recording_set_favorite,
            commands::recording_delete,
            commands::recording_reveal,
            commands::skin_catalog,
            commands::skin_inventory,
            commands::leaderboard_get,
            commands::live_game_get,
            commands::rank_history,
            commands::stats_baselines,
            commands::pro_teams,
            commands::lcu_spectate,
            commands::lcu_observable_friends,
            commands::lcu_match_history,
            commands::mayhem_catalog,
            commands::mayhem_rules,
            commands::mayhem_save_rule,
            commands::mayhem_delete_rule,
            commands::mayhem_rate,
            commands::mayhem_manual,
            commands::mayhem_demo,
            commands::mayhem_clear,
            commands::mayhem_confirm,
            commands::mayhem_confirmed,
            commands::mayhem_read_now,
            commands::mayhem_state,
            commands::mayhem_dataset,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement de NEX");

    app.run(|handle, event| {
        // Derniere fenetre fermee : en mode zone de notification, NEX reste actif (suivi du
        // client, overlay) sans aucune WebView principale chargee.
        if let RunEvent::ExitRequested { code: None, api, .. } = event {
            if windows::tray_mode(handle) {
                api.prevent_exit();
            }
        }
    });
}
