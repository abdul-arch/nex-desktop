//! Fenetre d'overlay unique : transparente, toujours au premier plan, hors barre des taches,
//! non focalisable et traversee par les clics en mode jeu. Tous les widgets partagent ce rendu.
//! Creee a la demande, detruite en fin de partie (la WebView est alors liberee).

use crate::error::{AppError, AppResult};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";

/// Mode configuration (widgets deplacables) actif ?
pub static CONFIG_MODE: AtomicBool = AtomicBool::new(false);

pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some()
}

pub fn open(app: &AppHandle, config: bool) -> AppResult<()> {
    let window = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => {
            let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
                .title("nex.lol — overlay")
                .transparent(true)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .focused(false)
                .focusable(false)
                .visible(false)
                .build()
                .map_err(|e| AppError::Unavailable(format!("création de l'overlay : {e}")))?;
            // Couvre l'ecran principal (le jeu doit etre en mode fenetre sans bordure).
            if let Ok(Some(m)) = w.primary_monitor() {
                let _ = w.set_position(PhysicalPosition::new(m.position().x, m.position().y));
                let _ = w.set_size(PhysicalSize::new(m.size().width, m.size().height));
            }
            w
        }
    };
    set_mode(app, config)?;
    window.show().map_err(|e| AppError::Unavailable(e.to_string()))?;
    Ok(())
}

pub fn set_mode(app: &AppHandle, config: bool) -> AppResult<()> {
    let w = app.get_webview_window(LABEL).ok_or_else(|| AppError::NotFound("overlay fermé".into()))?;
    CONFIG_MODE.store(config, Ordering::SeqCst);
    // Mode jeu : clics transmis au jeu et aucune prise de focus.
    w.set_ignore_cursor_events(!config).map_err(|e| AppError::Unavailable(e.to_string()))?;
    let _ = w.set_focusable(config);
    if config {
        let _ = w.set_focus();
    }
    let _ = app.emit("overlay://mode", config);
    Ok(())
}

pub fn toggle_visible(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        if w.is_visible().unwrap_or(true) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

pub fn close(app: &AppHandle) {
    CONFIG_MODE.store(false, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(LABEL) {
        // destroy() libere la WebView ; hide() la garderait en memoire.
        let _ = w.destroy();
    }
}
