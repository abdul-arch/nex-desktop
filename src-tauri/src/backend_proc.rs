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
use std::io::{Read, Write};
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

/// Ce qui tient le port, quand quelque chose le tient.
enum Occupant {
    Libre,
    /// Un backend NEX, avec la version qu'il annonce.
    Nex(String),
    /// Quelque chose repond, mais ce n'est pas un backend NEX.
    Autre,
}

/// Interroge `/v1/health` en HTTP/1.0 brut.
///
/// Un simple `connect` suffisait a savoir que le port etait pris, mais pas par quoi. Un
/// backend reste d'une session precedente (fermeture forcee) garde la main, et
/// l'application lui parlait en silence — y compris quand c'etait une version anterieure,
/// ce qui donne des champs vides impossibles a rattacher a leur cause.
///
/// Requete locale de quelques octets : pas de quoi reveiller un client HTTP et son
/// runtime dans une fonction synchrone de demarrage.
fn occupant() -> Occupant {
    let Ok(addr) = ADDR.parse::<SocketAddr>() else { return Occupant::Libre };
    let Ok(mut flux) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return Occupant::Libre;
    };
    let _ = flux.set_write_timeout(Some(Duration::from_millis(400)));
    let _ = flux.set_read_timeout(Some(Duration::from_millis(800)));
    if flux.write_all(b"GET /v1/health HTTP/1.0
Host: 127.0.0.1

").is_err() {
        return Occupant::Autre;
    }
    // HTTP/1.0 : le serveur ferme apres avoir repondu, la lecture s'arrete d'elle-meme.
    let mut rep = String::new();
    if flux.read_to_string(&mut rep).is_err() {
        return Occupant::Autre;
    }
    match version_annoncee(&rep) {
        Some(v) => Occupant::Nex(v),
        None => Occupant::Autre,
    }
}

/// Version annoncee par `/v1/health`, si la reponse vient bien d'un backend NEX.
///
/// Analyse a la main : la reponse tient en une ligne de JSON connue, et tirer un analyseur
/// complet pour deux champs couterait plus que ce que ca rapporte. `None` des que la
/// signature manque — mieux vaut dire « ce n'est pas un backend NEX » que de deviner.
fn version_annoncee(reponse: &str) -> Option<String> {
    if !reponse.contains("\"service\":\"nex-backend\"") {
        return None;
    }
    let v = reponse.split("\"version\":\"").nth(1)?.split('"').next()?;
    (!v.is_empty()).then(|| v.to_string())
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
    match occupant() {
        Occupant::Libre => {}
        Occupant::Nex(v) if v == env!("CARGO_PKG_VERSION") => {
            tracing_info(&format!("backend NEX {v} deja en ecoute : l'application n'en lance pas d'autre"));
            return;
        }
        Occupant::Nex(v) => {
            tracing_info(&format!(
                "ATTENTION : {ADDR} est tenu par un backend NEX {v}, alors que cette application est en {}.                  Elle ne le remplace pas. C'est probablement un backend reste d'une session precedente :                  le fermer, puis relancer l'application.",
                env!("CARGO_PKG_VERSION")
            ));
            return;
        }
        Occupant::Autre => {
            tracing_info(&format!(
                "ATTENTION : {ADDR} est tenu par un programme qui ne repond pas comme un backend NEX.                  L'application ne le remplace pas ; ses donnees resteront indisponibles."
            ));
            return;
        }
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

#[cfg(test)]
mod tests {
    use super::version_annoncee;

    /// Reponse reelle du backend, en-tetes compris : c'est ce que la sonde lit.
    const REELLE: &str = "HTTP/1.0 200 OK
content-type: application/json

{\"service\":\"nex-backend\",\"version\":\"0.1.0\",\"riotKeyConfigured\":true}";

    #[test]
    fn lit_la_version_du_backend() {
        assert_eq!(version_annoncee(REELLE).as_deref(), Some("0.1.0"));
    }

    #[test]
    fn refuse_ce_qui_n_est_pas_un_backend_nex() {
        // Un autre serveur sur le meme port ne doit pas passer pour le notre.
        assert_eq!(version_annoncee("HTTP/1.0 200 OK

<html>Bienvenue</html>"), None);
        assert_eq!(version_annoncee("{\"service\":\"autre-chose\",\"version\":\"9.9\"}"), None);
        assert_eq!(version_annoncee(""), None);
    }

    #[test]
    fn refuse_une_version_absente_ou_vide() {
        // Signature bonne mais version illisible : on ne devine pas une egalite de version.
        assert_eq!(version_annoncee("{\"service\":\"nex-backend\"}"), None);
        assert_eq!(version_annoncee("{\"service\":\"nex-backend\",\"version\":\"\"}"), None);
    }
}
