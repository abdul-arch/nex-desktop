//! Essais de bout en bout contre le client League reel (ignores par defaut).
//! Ils utilisent exactement le code de l'application (TLS epingle, chemins fixes) et
//! n'affichent ni nom de joueur ni cle.
//!
//! - `cargo test -p nex --lib -- --ignored region_probe --nocapture`
//! - `cargo test -p nex --lib -- --ignored spectator_api_probe --nocapture`
//! - `cargo test -p nex --lib -- --ignored friend_spectate_probe --nocapture`
//!   (avec `$env:NEX_DO_SPECTATE="1"` : ouvre reellement la partie d'un ami en spectateur)
//! - `cargo test -p nex --lib -- --ignored live_probe --nocapture` (jeu en cours requis)

use crate::adapters::lcu::{Lcu, find_install_dir, paths, pinned_client, read_credentials};
use serde_json::Value;
use std::time::Duration;

fn connect() -> Lcu {
    let dir = find_install_dir(sysinfo::System::new().ok().as_mut()).expect("client League introuvable");
    let creds = read_credentials(&dir).expect("lockfile illisible");
    Lcu::new(pinned_client(Duration::from_secs(8)).unwrap(), creds)
}

/// Region du client et phase de jeu.
#[tokio::test]
#[ignore]
async fn region_probe() {
    let lcu = connect();
    let region: Value = lcu.get(paths::REGION).await.expect("region");
    let phase: String = lcu.get(paths::PHASE).await.expect("phase");
    println!("region={} locale={} phase={phase}", region["region"].as_str().unwrap_or("?"), region["locale"].as_str().unwrap_or("?"));
}

/// Documentation embarquee du client : fonctions et types du mode spectateur.
#[tokio::test]
#[ignore]
async fn spectator_api_probe() {
    let lcu = connect();
    let help: Value = lcu.get("/help?format=Full").await.expect("help");
    let entries = |k: &str| -> Vec<Value> {
        match help.get(k).cloned().unwrap_or(Value::Null) {
            Value::Array(a) => a,
            Value::Object(o) => o.into_iter().map(|(n, v)| serde_json::json!({ "name": n, "desc": v })).collect(),
            _ => vec![],
        }
    };
    for f in entries("functions").iter().filter(|f| f["name"].as_str().is_some_and(|n| n.to_lowercase().contains("spectat"))) {
        let args: Vec<String> = f["arguments"].as_array().map(|a| a.iter().map(|x| x["name"].as_str().unwrap_or("?").to_string()).collect()).unwrap_or_default();
        println!("FN {}({})", f["name"].as_str().unwrap_or("?"), args.join(", "));
    }
    for t in entries("types").iter().filter(|t| t["name"].as_str().is_some_and(|n| n.to_lowercase().contains("spectategameinfo"))) {
        let fields: Vec<String> = t["fields"].as_array().map(|a| a.iter().map(|f| f["name"].as_str().unwrap_or("?").to_string()).collect()).unwrap_or_default();
        println!("TYPE {} {{ {} }}", t["name"].as_str().unwrap_or("?"), fields.join(", "));
    }
}

/// Fonctions, evenements et types du client dont le nom contient un des termes de
/// NEX_HELP_FILTER (separes par des virgules). Lecture seule de la documentation embarquee.
#[tokio::test]
#[ignore]
async fn lcu_help_probe() {
    let terms: Vec<String> = std::env::var("NEX_HELP_FILTER").expect("NEX_HELP_FILTER requis").split(',').map(|t| t.trim().to_lowercase()).collect();
    let lcu = connect();
    let help: Value = lcu.get("/help?format=Full").await.expect("help");
    for section in ["functions", "events", "types"] {
        let entries: Vec<Value> = match help.get(section).cloned().unwrap_or(Value::Null) {
            Value::Array(a) => a,
            Value::Object(o) => o.into_iter().map(|(n, v)| serde_json::json!({ "name": n, "desc": v })).collect(),
            _ => vec![],
        };
        for e in entries {
            let name = e["name"].as_str().unwrap_or("");
            if !terms.iter().any(|t| name.to_lowercase().contains(t)) {
                continue;
            }
            let detail: Vec<String> = e["arguments"]
                .as_array()
                .or_else(|| e["fields"].as_array())
                .map(|a| a.iter().map(|x| x["name"].as_str().unwrap_or("?").to_string()).collect())
                .unwrap_or_default();
            println!("{section}: {name} [{}]", detail.join(", "));
        }
    }
}

/// Amis en partie observable (comptes uniquement) ; ouvre la partie du premier ami en partie
/// classique ou ARAM si NEX_DO_SPECTATE=1, par le meme chemin que le bouton de l'application.
#[tokio::test]
#[ignore]
async fn friend_spectate_probe() {
    let lcu = connect();
    let friends: Vec<Value> = lcu.get(paths::FRIENDS).await.expect("amis");
    let observable = super::spectate::observable(&friends);
    let count = |pred: &dyn Fn(&Value) -> bool| friends.iter().filter(|f| pred(f)).count();
    println!(
        "amis={} en_partie={} dont_observables={} dont_avec_cle={} observables_retenus={}",
        friends.len(),
        count(&|f| f["lol"]["gameStatus"] == "inGame"),
        count(&|f| f["lol"]["gameStatus"] == "inGame" && f["lol"]["isObservable"] == "ALL"),
        count(&|f| f["lol"]["gameStatus"] == "inGame" && f["lol"]["isObservable"] == "ALL" && f["lol"]["spectatorKey"].as_str().is_some_and(|k| !k.is_empty())),
        observable.len()
    );
    if std::env::var("NEX_DO_SPECTATE").is_ok() {
        // NEX_SPECTATE_MODE (ex. KIWI) : choisit un ami dans ce mode de jeu.
        let mode = std::env::var("NEX_SPECTATE_MODE").ok();
        let target = observable
            .iter()
            .find(|o| {
                mode.as_deref().is_none_or(|m| {
                    friends.iter().any(|f| {
                        f["lol"]["gameMode"].as_str() == Some(m)
                            && format!("{}#{}", f["gameName"].as_str().unwrap_or(""), f["gameTag"].as_str().unwrap_or("")).eq_ignore_ascii_case(&o.riot_id)
                    })
                })
            })
            .expect("aucun ami en partie observable dans ce mode");
        let id = nex_domain::riot::RiotId::parse(&target.riot_id).unwrap();
        match super::spectate::launch(&lcu, &id).await {
            Ok(()) => println!("spectate=accepte"),
            Err(e) => panic!("spectate refuse : {e}"),
        }
    }
}

/// Quitte proprement le mode spectateur (sinon le client relance le jeu tant que la phase
/// reste « InProgress »).
#[tokio::test]
#[ignore]
async fn spectate_quit_probe() {
    let lcu = connect();
    println!("quit={}", lcu.spectate_quit().await.expect("quit"));
}

/// Lie le compte connecte au client League au dashboard et quitte le mode demonstration,
/// comme le bouton « Lier ce compte » de la page Partie en direct. Ecrit dans la base NEX ;
/// recharger la fenetre principale ensuite. Affiche seulement le Riot ID du compte lie.
#[tokio::test]
#[ignore]
async fn link_client_account_probe() {
    let lcu = connect();
    let s: Value = lcu.get(paths::SUMMONER).await.expect("compte du client");
    let region: Value = lcu.get(paths::REGION).await.expect("region du client");
    let riot_id = format!("{}#{}", s["gameName"].as_str().unwrap_or(""), s["tagLine"].as_str().unwrap_or(""));
    let platform = region["region"].as_str().and_then(super::model::platform_of_region).expect("region non reconnue");
    let path = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("gg.nex.desktop").join("nex.sqlite3");
    let conn = rusqlite::Connection::open(&path).expect("base NEX");
    conn.busy_timeout(Duration::from_secs(5)).unwrap();
    use crate::persistence::settings::set;
    set(&conn, "linkedRiotId", &serde_json::json!(riot_id)).expect("Riot ID");
    set(&conn, "linkedPlatform", &serde_json::json!(platform)).expect("region");
    let after = set(&conn, "demoMode", &serde_json::json!(false)).expect("mode demo");
    println!("compte lie : {} ({}) · mode demo : {}", after.linked_riot_id, after.linked_platform, after.demo_mode);
}

/// Parties ARAM Mayhem lues dans l'historique du client, par le meme code que l'application
/// (base en memoire : rien n'est ecrit). N'affiche que des totaux et le champion du joueur.
#[tokio::test]
#[ignore]
async fn mayhem_history_probe() {
    let lcu = connect();
    let me: Value = lcu.get(paths::SUMMONER).await.expect("compte du client");
    let id = nex_domain::riot::RiotId::new(me["gameName"].as_str().unwrap_or(""), me["tagLine"].as_str().unwrap_or("")).expect("Riot ID du client");
    let db = crate::persistence::Db::open_in_memory().unwrap();
    // Cles de champions : identifiant numerique seulement (pas de catalogue dans cet essai).
    let keys: std::collections::HashMap<i32, String> = (1..1000).map(|i| (i, format!("c{i}"))).collect();
    let api_puuid = "PUUID-API-DE-TEST-0000000000000000000000000000000000";
    let t0 = std::time::Instant::now();
    let list = super::history::mayhem_matches(&lcu, &db, &id, api_puuid, 20, &keys).await.expect("historique");
    let first = t0.elapsed();
    let t1 = std::time::Instant::now();
    let again = super::history::mayhem_matches(&lcu, &db, &id, api_puuid, 20, &keys).await.expect("historique (cache)");
    println!("parties={} premiere_lecture={} ms relecture={} ms", list.len(), first.as_millis(), t1.elapsed().as_millis());
    assert_eq!(list.len(), again.len());
    for m in &list {
        let mine = m.participants.iter().filter(|p| p.puuid == api_puuid).count();
        let me = m.participants.iter().find(|p| p.puuid == api_puuid);
        println!(
            "{} file={} mode={} joueurs={} moi={} equipes={} duree={}s {}",
            m.id,
            m.queue_id,
            m.game_mode,
            m.participants.len(),
            mine,
            m.teams.len(),
            m.duration_sec,
            me.map(|p| format!("{} {}/{}/{} {}", p.champion, p.kills, p.deaths, p.assists, if p.win { "victoire" } else { "defaite" })).unwrap_or_default()
        );
        assert_eq!(mine, 1, "le joueur connecte doit etre reconnu une seule fois");
    }
    // Un autre Riot ID que celui du client : aucune partie.
    let other = nex_domain::riot::RiotId::new("Quelqu Un Dautre", "EUW").unwrap();
    assert!(super::history::mayhem_matches(&lcu, &db, &other, api_puuid, 20, &keys).await.unwrap().is_empty());
}

/// Disposition des widgets enregistree par l'application (base ouverte en lecture seule).
#[test]
#[ignore]
fn overlay_layout_probe() {
    let path = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("gg.nex.desktop").join("nex.sqlite3");
    let conn = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).expect("base NEX");
    for w in crate::persistence::overlay::load(&conn).unwrap() {
        println!("widget {} x={:.4} y={:.4} visible={} verrouille={}", w.id, w.x, w.y, w.visible, w.locked);
    }
}

/// Schema publie par le jeu (OpenAPI de Live Client Data) : chemins et champs lies aux
/// augments, puis champs reels d'un joueur et de la partie en cours.
#[tokio::test]
#[ignore]
async fn live_schema_probe() {
    let http = pinned_client(Duration::from_secs(6)).unwrap();
    let schema: Value = http.get("https://127.0.0.1:2999/swagger/v3/openapi.json").send().await.expect("schema").json().await.expect("json");
    let paths: Vec<&String> = schema["paths"].as_object().map(|o| o.keys().collect()).unwrap_or_default();
    println!("chemins ({}): {}", paths.len(), paths.iter().map(|p| p.as_str()).collect::<Vec<_>>().join(" "));
    let text = schema.to_string().to_lowercase();
    for term in ["augment", "cherry", "kiwi", "mayhem", "arena"] {
        println!("terme {term}: {} occurrence(s)", text.matches(term).count());
    }
    let all = crate::adapters::lcu::live_all(&http).await.expect("allgamedata");
    println!("gameData: {}", all["gameData"].as_object().map(|o| o.keys().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_default());
    println!("joueur: {}", all["allPlayers"][0].as_object().map(|o| o.keys().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_default());
    let names: Vec<String> = all["events"]["Events"].as_array().map(|a| a.iter().filter_map(|e| e["EventName"].as_str().map(str::to_string)).collect()).unwrap_or_default();
    let mut uniq = names.clone();
    uniq.sort();
    uniq.dedup();
    println!("mode={} evenements: {}", all["gameData"]["gameMode"], uniq.join(", "));
}

/// Live Client Data du jeu en cours (port 2999), passee par le meme modele que l'overlay.
#[tokio::test]
#[ignore]
async fn live_probe() {
    let http = pinned_client(Duration::from_secs(4)).unwrap();
    let all = crate::adapters::lcu::live_all(&http).await.expect("Live Client Data indisponible");
    println!("activePlayer: {}", all.get("activePlayer").map(|a| a.to_string().chars().take(120).collect::<String>()).unwrap_or("absent".into()));
    let snap = super::model::live_snapshot(&all).expect("instantane");
    println!(
        "temps={:.0}s mode={} joueurs={} avec_champion={} avec_objets={} avec_poste={} actif={} minuteurs={}",
        snap.game_time,
        snap.game_mode,
        snap.players.len(),
        snap.players.iter().filter(|p| !p.champion_key.is_empty()).count(),
        snap.players.iter().filter(|p| !p.items.is_empty()).count(),
        snap.players.iter().filter(|p| p.position.is_some()).count(),
        snap.players.iter().any(|p| p.is_active),
        snap.objectives.len()
    );
}
