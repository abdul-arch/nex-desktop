//! Fenetre principale (creee en code pour pouvoir etre detruite puis recreee), zone de
//! notification et raccourcis globaux.

use crate::overlay;
use crate::persistence::settings;
use crate::state::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const MAIN: &str = "main";

pub fn open_main(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("nex.lol")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 640.0)
        .center()
        .decorations(false)
        .resizable(true)
        .background_color(tauri::window::Color(11, 12, 16, 255))
        .build()?;
    Ok(())
}

/// Mode « zone de notification » : la fenetre principale est detruite (WebView liberee),
/// seuls le suivi du client et l'overlay restent actifs.
pub fn tray_mode(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|s| s.db.with(settings::load).ok())
        .is_some_and(|s| s.close_behavior == "tray")
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Ouvrir NEX", true, None::<&str>)?;
    let overlay_item = MenuItem::with_id(app, "overlay", "Afficher / masquer l'overlay (Ctrl+Alt+H)", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter NEX", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &overlay_item, &quit])?;
    let mut builder = TrayIconBuilder::with_id("nex-tray").tooltip("NEX").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => {
                let _ = open_main(app);
            }
            "overlay" => overlay::toggle_visible(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                let _ = open_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Ctrl+Alt+N : mode configuration de l'overlay ; Ctrl+Alt+H : afficher/masquer l'overlay ;
/// Ctrl+Alt+R : sauvegarder le replay instantane (capture active uniquement).
pub fn shortcuts_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let config = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
    let hide = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);
    let replay = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR);
    // ARAM Mayhem : lecture des cartes (assistance demandee) et panneau de detail.
    let mayhem_read = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA);
    let mayhem_panel = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyD);
    // Rappel : revele les widgets regles sur « sur une touche », tant qu'elle est maintenue.
    let hold = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyE);
    let panel_open = std::sync::atomic::AtomicBool::new(false);
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            // Le rappel est le seul raccourci qui reagit aussi au relachement.
            if shortcut == &hold {
                let _ = tauri::Emitter::emit(app, "overlay://hold", event.state() == ShortcutState::Pressed);
                return;
            }
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if shortcut == &config {
                if overlay::is_open(app) {
                    let next = !overlay::CONFIG_MODE.load(std::sync::atomic::Ordering::SeqCst);
                    let _ = overlay::set_mode(app, next);
                } else {
                    let _ = overlay::open(app, true);
                }
            } else if shortcut == &hide {
                overlay::toggle_visible(app);
            } else if shortcut == &mayhem_read {
                if let Some(svc) = app.try_state::<std::sync::Arc<crate::mayhem::service::MayhemService>>() {
                    svc.start_session(app, crate::mayhem::service::SESSION_HOTKEY);
                }
            } else if shortcut == &mayhem_panel {
                let next = !panel_open.fetch_xor(true, std::sync::atomic::Ordering::SeqCst);
                let _ = tauri::Emitter::emit(app, "mayhem://panel", next);
            } else if shortcut == &replay {
                let app = app.clone();
                std::thread::spawn(move || {
                    let Some(cap) = app.try_state::<std::sync::Arc<crate::capture::service::CaptureService>>() else { return };
                    let secs = app.try_state::<AppState>().and_then(|s| s.db.with(settings::load).ok()).map(|s| s.replay_seconds).unwrap_or(120);
                    let result = cap.save_clip(&app, secs, None);
                    let _ = tauri::Emitter::emit(&app, "capture://clip", result.map(|r| r.title).map_err(|e| e.to_string()));
                });
            }
        })
        .build()
}

/// Raccourcis que Windows a refuses, parce qu'une autre application les detient deja.
/// Sans cette liste, l'echec restait invisible et la fonction paraissait simplement cassee.
pub static FAILED_SHORTCUTS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

pub fn register_shortcuts(app: &AppHandle) {
    let gs = app.global_shortcut();
    for s in [
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyD),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyE),
    ] {
        // Un raccourci deja pris par une autre application n'empeche pas NEX de demarrer.
        if gs.register(s).is_err() {
            let name = format!("Ctrl+Alt+{:?}", s.key).replace("Key", "");
            eprintln!("raccourci global indisponible : {name}");
            if let Ok(mut f) = FAILED_SHORTCUTS.lock() {
                f.push(name);
            }
        }
    }
}
