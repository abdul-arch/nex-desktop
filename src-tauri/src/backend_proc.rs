//! Demarrage du backend NEX embarque.
//!
//! POURQUOI : jusqu'ici le backend devait etre lance a la main (`cargo run -p nex-backend`).
//! Des qu'il ne tournait pas, l'application etait a moitie muette, sans rien pouvoir y
//! faire. Elle le demarre maintenant elle-meme et l'arrete en quittant.
//!
//! CE QU'ELLE NE FAIT PAS : si quelque chose ecoute deja sur le port, elle n'y touche pas.
//! Un backend lance a la main, en developpement, garde donc la main et sa propre base.
//!
//! LA CLE RIOT ne quitte pas la machine et n'entre jamais dans le binaire : elle est lue
//! dans les reglages de l'application et passee au processus par une variable
//! d'environnement, jamais par un fichier ecrit par nous ni par la ligne de commande (que
//! les autres processus de la machine peuvent lire).

use crate::persistence::settings;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Adresse que le backend sert, et que l'application interroge par defaut.
const ADDR: &str = "127.0.0.1:8787";

/// Processus fils, garde pour etre arrete avec l'application.
#[derive(Default)]
pub struct BackendProcess(Mutex<Option<Child>>);

/// Vrai si quelque chose repond deja sur le port : on laisse alors la place.
fn already_running() -> bool {
    let Ok(addr) = ADDR.parse::<SocketAddr>() else { return false };
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// Binaire embarque, place par Tauri a cote de l'executable principal.
fn sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let p = exe.parent()?.join(if cfg!(windows) { "nex-backend.exe" } else { "nex-backend" });
    p.is_file().then_some(p)
}

/// Demarre le backend embarque si besoin. Ne renvoie jamais d'erreur a l'appelant : une
/// application sans backend reste utilisable, et l'interface signale deja son absence.
pub fn start_if_needed(app: &AppHandle) {
    if already_running() {
        tracing_info("backend deja en ecoute : l'application n'en lance pas d'autre");
        return;
    }
    let Some(exe) = sidecar_path() else {
        // Cas normal en developpement : le binaire n'est pas a cote de l'executable.
        tracing_info("backend embarque absent : lance-le a la main (cargo run -p nex-backend)");
        return;
    };
    let Some(state) = app.try_state::<crate::AppState>() else { return };
    let st = state.db.with(settings::load).unwrap_or_default();
    // Base du backend : dossier local de l'application, pas « Roaming ». Les parties
    // collectees atteignent plusieurs centaines de Mo ; ces donnees n'ont rien a faire
    // dans un profil synchronise.
    let dir = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);

    let mut cmd = Command::new(exe);
    cmd.env("NEX_BACKEND_DB", dir.join("nex-backend.sqlite3"));
    cmd.env("NEX_BACKEND_BIND", ADDR);
    if !st.riot_api_key.is_empty() {
        cmd.env("RIOT_API_KEY", &st.riot_api_key);
    }
    // Pas de fenetre de console sur Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    match cmd.spawn() {
        Ok(child) => {
            tracing_info("backend embarque demarre");
            if let Some(slot) = app.try_state::<BackendProcess>() {
                if let Ok(mut g) = slot.0.lock() {
                    *g = Some(child);
                }
            }
        }
        Err(e) => tracing_info(&format!("backend embarque non demarre : {e}")),
    }
}

/// Arrete le backend que nous avons demarre. Sans effet sur un backend lance a la main.
pub fn stop(app: &AppHandle) {
    let Some(slot) = app.try_state::<BackendProcess>() else { return };
    let Ok(mut g) = slot.0.lock() else { return };
    if let Some(mut child) = g.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn tracing_info(msg: &str) {
    eprintln!("[backend] {msg}");
}
