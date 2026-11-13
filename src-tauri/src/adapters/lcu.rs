//! Client League local (LCU) et Live Client Data API.
//!
//! Securite :
//! - TLS epingle sur l'autorite racine Riot (certs/riotgames.pem) : `tls_certs_only`, aucune autre
//!   racine acceptee, validation de nom d'hote conservee (le certificat couvre 127.0.0.1) ;
//! - connexions limitees a 127.0.0.1 (port du lockfile pour le LCU, 2999 pour Live Client) ;
//! - chemins d'API fixes (constantes) ; seuls des identifiants numeriques sont interpoles ;
//! - le mot de passe du lockfile n'est jamais journalise ni transmis a l'interface.

use crate::error::{AppError, AppResult};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

const RIOT_ROOT_PEM: &[u8] = include_bytes!("../../certs/riotgames.pem");

pub fn pinned_client(timeout: Duration) -> AppResult<reqwest::Client> {
    let cert = reqwest::Certificate::from_pem(RIOT_ROOT_PEM).map_err(|e| AppError::Unavailable(format!("certificat Riot invalide : {e}")))?;
    reqwest::Client::builder()
        .tls_certs_only([cert])
        .https_only(true)
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(2))
        .pool_max_idle_per_host(1)
        .no_proxy()
        .build()
        .map_err(|e| AppError::Unavailable(format!("client TLS local : {e}")))
}

// ---------- Decouverte (lockfile) ----------

#[derive(Clone)]
pub struct Credentials {
    pub port: u16,
    password: String,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials").field("port", &self.port).field("password", &"<masque>").finish()
    }
}

/// Format : `LeagueClient:<pid>:<port>:<motdepasse>:https`
pub fn parse_lockfile(content: &str) -> Option<Credentials> {
    let parts: Vec<&str> = content.trim().split(':').collect();
    if parts.len() != 5 || parts[4] != "https" {
        return None;
    }
    let port: u16 = parts[2].parse().ok().filter(|p| *p >= 1024)?;
    let password = parts[3];
    if password.is_empty() || password.len() > 128 || !password.bytes().all(|b| b.is_ascii_graphic()) {
        return None;
    }
    Some(Credentials { port, password: password.to_string() })
}

const DEFAULT_DIRS: &[&str] = &[
    r"C:\Riot Games\League of Legends",
    r"D:\Riot Games\League of Legends",
    r"C:\Program Files\Riot Games\League of Legends",
];

/// Dossier d'installation : processus LeagueClientUx en cours, sinon emplacements usuels.
pub fn find_install_dir(sys: Option<&mut sysinfo::System>) -> Option<PathBuf> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, UpdateKind};
    let Some(sys) = sys else {
        return DEFAULT_DIRS.iter().map(PathBuf::from).find(|d| d.join("lockfile").is_file());
    };
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        if name == "leagueclientux.exe" || name == "leagueclient.exe" {
            if let Some(dir) = p.exe().and_then(Path::parent) {
                if dir.join("lockfile").is_file() {
                    return Some(dir.to_path_buf());
                }
            }
        }
    }
    DEFAULT_DIRS.iter().map(PathBuf::from).find(|d| d.join("lockfile").is_file())
}

pub fn read_credentials(dir: &Path) -> Option<Credentials> {
    let content = std::fs::read_to_string(dir.join("lockfile")).ok()?;
    parse_lockfile(&content)
}

// ---------- Client LCU ----------

/// Chemins autorises (lecture). Les ecritures ont leurs propres fonctions dediees.
pub mod paths {
    pub const PHASE: &str = "/lol-gameflow/v1/gameflow-phase";
    pub const SUMMONER: &str = "/lol-summoner/v1/current-summoner";
    pub const REGION: &str = "/riotclient/region-locale";
    pub const CHAMP_SELECT: &str = "/lol-champ-select/v1/session";
    pub const PERK_PAGES: &str = "/lol-perks/v1/pages";
    pub const PERK_INVENTORY: &str = "/lol-perks/v1/inventory";
    pub const PERK_CURRENT: &str = "/lol-perks/v1/currentpage";
    pub const INVENTORY_SKINS: &str = "/lol-inventory/v2/inventory/CHAMPION_SKIN";
    /// Liste d'amis et presence (lecture seule) : cle d'observation des parties des amis.
    pub const FRIENDS: &str = "/lol-chat/v1/friends";
}

#[derive(Clone)]
pub struct Lcu {
    http: reqwest::Client,
    creds: Credentials,
}

impl Lcu {
    pub fn new(http: reqwest::Client, creds: Credentials) -> Self {
        Self { http, creds }
    }

    fn url(&self, path: &str) -> String {
        format!("https://127.0.0.1:{}{}", self.creds.port, path)
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
        req.basic_auth("riot", Some(&self.creds.password))
            .send()
            .await
            .map_err(|e| if e.is_connect() { AppError::Unavailable("client League fermé".into()) } else { AppError::Unavailable(format!("client League : {}", short(&e))) })
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &'static str) -> AppResult<T> {
        self.get_path(path).await
    }

    /// Historique des parties du compte connecte (lecture seule) : les `count` plus recentes,
    /// avec seulement le joueur connecte dans chaque partie.
    pub async fn match_history(&self, count: u32) -> AppResult<Value> {
        let end = count.clamp(1, 100) - 1;
        self.get_path(&format!("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex={end}")).await
    }

    /// Detail d'une partie de l'historique du client (les dix joueurs). L'identifiant est un
    /// nombre : aucun texte libre n'entre dans le chemin.
    pub async fn match_history_game(&self, game_id: u64) -> AppResult<Value> {
        self.get_path(&format!("/lol-match-history/v1/games/{game_id}")).await
    }

    /// Chemin construit par ce module uniquement (jamais par un appelant).
    async fn get_path<T: DeserializeOwned>(&self, path: &str) -> AppResult<T> {
        let resp = self.send(self.http.get(self.url(path))).await?;
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::NotFound("ressource absente du client".into()));
        }
        if !status.is_success() {
            return Err(AppError::Unavailable(format!("client League : réponse {}", status.as_u16())));
        }
        resp.json().await.map_err(|e| AppError::Unavailable(format!("réponse du client illisible : {}", short(&e))))
    }

    pub async fn delete_perk_page(&self, id: i64) -> AppResult<()> {
        let resp = self.send(self.http.delete(self.url(&format!("{}/{id}", paths::PERK_PAGES)))).await?;
        if resp.status().is_success() { Ok(()) } else { Err(AppError::Unavailable(format!("suppression de page refusée ({})", resp.status().as_u16()))) }
    }

    /// Cree une page ; renvoie (statut, corps) pour distinguer « capacite atteinte ».
    pub async fn create_perk_page(&self, body: &Value) -> AppResult<(u16, String)> {
        let resp = self.send(self.http.post(self.url(paths::PERK_PAGES)).json(body)).await?;
        let status = resp.status().as_u16();
        Ok((status, resp.text().await.unwrap_or_default()))
    }

    /// Lance le mode spectateur du client pour la partie en cours d'un joueur (action du joueur).
    /// `spectator_key` : cle de la presence de l'ami (voir `client::spectate`). Sans elle, le
    /// client repond « spectator key is missing » (verifie sur un client reel, 11/2026).
    pub async fn spectate(&self, puuid: &str, spectator_key: &str) -> AppResult<()> {
        let body = serde_json::json!({
            "allowObserveMode": "ALL",
            "dropInSpectateGameId": "",
            "gameQueueType": "",
            "puuid": puuid,
            "spectatorKey": spectator_key,
        });
        let resp = self.send(self.http.post(self.url("/lol-spectator/v1/spectate/launch")).json(&body)).await?;
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            let text: String = resp.text().await.unwrap_or_default().chars().filter(|c| !c.is_control()).take(600).collect();
            Err(AppError::Unavailable(format!("le client a refusé le mode spectateur ({}) {text}", status.as_u16())))
        }
    }

    /// Quitte le mode spectateur (essais de bout en bout uniquement).
    #[cfg(test)]
    pub async fn spectate_quit(&self) -> AppResult<u16> {
        let resp = self.send(self.http.post(self.url("/lol-gameflow/v1/spectate/quit"))).await?;
        Ok(resp.status().as_u16())
    }

    pub async fn get_item_sets(&self, summoner_id: u64) -> AppResult<Value> {
        let resp = self.send(self.http.get(self.url(&format!("/lol-item-sets/v1/item-sets/{summoner_id}/sets")))).await?;
        if !resp.status().is_success() {
            return Err(AppError::Unavailable(format!("lecture des sets d'objets refusée ({})", resp.status().as_u16())));
        }
        resp.json().await.map_err(|e| AppError::Unavailable(format!("sets d'objets illisibles : {}", short(&e))))
    }

    pub async fn put_item_sets(&self, summoner_id: u64, body: &Value) -> AppResult<()> {
        let resp = self.send(self.http.put(self.url(&format!("/lol-item-sets/v1/item-sets/{summoner_id}/sets"))).json(body)).await?;
        if resp.status().is_success() { Ok(()) } else { Err(AppError::Unavailable(format!("écriture des sets d'objets refusée ({})", resp.status().as_u16()))) }
    }
}

/// Message d'erreur sans URL (qui contiendrait le port) ni identifiants.
fn short(e: &reqwest::Error) -> String {
    let mut s = e.to_string();
    if let Some(url) = e.url() {
        s = s.replace(url.as_str(), "<client local>");
    }
    s
}

// ---------- Live Client Data API (pendant une partie) ----------

pub const LIVE_ALL: &str = "https://127.0.0.1:2999/liveclientdata/allgamedata";

pub async fn live_all(http: &reqwest::Client) -> AppResult<Value> {
    let resp = http.get(LIVE_ALL).send().await.map_err(|e| {
        if e.is_connect() { AppError::Unavailable("aucune partie en cours".into()) } else { AppError::Unavailable(format!("Live Client : {}", short(&e))) }
    })?;
    if !resp.status().is_success() {
        // 404 pendant l'ecran de chargement : la partie n'a pas commence.
        return Err(AppError::Unavailable(format!("Live Client : réponse {}", resp.status().as_u16())));
    }
    resp.json().await.map_err(|e| AppError::Unavailable(format!("Live Client illisible : {}", short(&e))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lockfile_parsing() {
        let c = parse_lockfile("LeagueClient:1234:60925:s3cr3t-Pass_word:https").unwrap();
        assert_eq!(c.port, 60925);
        assert!(!format!("{c:?}").contains("s3cr3t"));
        assert!(parse_lockfile("LeagueClient:1234:60925:pw:http").is_none());
        assert!(parse_lockfile("LeagueClient:1234:80:pw:https").is_none());
        assert!(parse_lockfile("garbage").is_none());
        assert!(parse_lockfile("LeagueClient:1:60925::https").is_none());
    }

    #[test]
    fn pinned_client_builds() {
        assert!(pinned_client(Duration::from_secs(2)).is_ok());
    }

    /// Integration (client League ouvert requis) : `cargo test -p nex -- --ignored lcu_probe --nocapture`.
    /// Lecture seule ; n'affiche aucune donnee personnelle.
    #[tokio::test]
    #[ignore]
    async fn lcu_probe() {
        let dir = find_install_dir(sysinfo::System::new().ok().as_mut()).expect("client League introuvable");
        let creds = read_credentials(&dir).expect("lockfile illisible");
        let lcu = Lcu::new(pinned_client(Duration::from_secs(4)).unwrap(), creds);
        let phase: String = lcu.get(paths::PHASE).await.expect("TLS epingle ou phase en echec");
        let pages: Vec<Value> = lcu.get(paths::PERK_PAGES).await.unwrap();
        let session = lcu.get::<Value>(paths::CHAMP_SELECT).await;
        println!("phase={phase} pages={} champ_select={}", pages.len(), if session.is_ok() { "active" } else { "aucune" });
        // Un hote autre que 127.0.0.1 avec le meme client epingle doit etre refuse.
        let other = pinned_client(Duration::from_secs(4)).unwrap().get("https://ddragon.leagueoflegends.com/api/versions.json").send().await;
        assert!(other.is_err(), "le client epingle ne doit faire confiance qu'a la racine Riot");
    }
}
