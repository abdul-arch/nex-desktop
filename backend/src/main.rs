//! Backend NEX.
//!
//! Lancement : `cargo run -p nex-backend` depuis le dossier `backend/` (lit `backend/.env`).
//! Il detient la cle Riot, applique les limites de debit, deduplique et met en cache.

mod analytics;
mod collector;
mod config;
mod error;
mod items;
mod limiter;
mod mayhem;
mod normalize;
mod pro;
mod riot;
mod routes;
mod store;

use std::sync::Arc;

#[tokio::main]
async fn main() {
    // Uniquement backend/.env (lancement depuis la racine) ou ./.env si on est deja dans backend/.
    // Pas de recherche dans les dossiers parents : un .env etranger au projet ne doit jamais etre lu.
    // Les variables d'environnement deja definies priment.
    let env_file = if std::path::Path::new("backend/.env").is_file() {
        Some(std::path::PathBuf::from("backend/.env"))
    } else if std::path::Path::new("Cargo.toml").is_file() && std::path::Path::new(".env").is_file() {
        Some(std::path::PathBuf::from(".env"))
    } else {
        None
    };
    if let Some(path) = &env_file {
        let _ = dotenvy::from_path(path);
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "nex_backend=info".into()),
        )
        .init();

    let config = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("configuration invalide : {e}");
            std::process::exit(2);
        }
    };
    tracing::info!(
        "configuration : {}",
        env_file.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "aucun fichier .env (variables d'environnement seules)".into())
    );
    if config.riot_api_key.is_none() {
        tracing::warn!("RIOT_API_KEY absente : seules les donnees deja en cache seront servies");
    }
    if !config.bind.ip().is_loopback() {
        tracing::warn!(
            "ecoute sur {} : ce backend n'a pas encore d'authentification client, ne pas l'exposer publiquement",
            config.bind
        );
    }

    let store = match store::Store::open(&config.db_path) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            tracing::error!("ouverture du cache impossible : {e}");
            std::process::exit(2);
        }
    };
    match store.purge_if_key_changed(config.riot_api_key.as_deref()) {
        Ok(true) => tracing::info!("cle Riot differente de la precedente : cache vide (les PUUID sont chiffres par cle)"),
        Ok(false) => {}
        Err(e) => tracing::warn!("empreinte de cle non verifiee : {e}"),
    }
    if let Ok(n) = store.purge() {
        tracing::info!("cache : {n} entree(s) expiree(s) purgee(s)");
    }

    if let Err(e) = store.with(analytics::init) {
        tracing::error!("schema analytique : {e}");
        std::process::exit(2);
    }
    let collector_cfg = match config::collector_from_env() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("configuration du collecteur invalide : {e}");
            std::process::exit(2);
        }
    };
    let key_present = config.riot_api_key.is_some();
    let riot = riot::RiotClient::new(config.riot_api_key.clone(), &config.app_limits, config.max_concurrency, store);
    let collector = collector::CollectorHandle::new(collector_cfg);
    let state = Arc::new(routes::AppState { riot, collector: collector.clone() });
    if collector.config.enabled {
        if key_present {
            let http = reqwest::Client::builder()
                .user_agent(concat!("NEX-Backend/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("client HTTP");
            tokio::spawn(collector::run(state.clone(), collector, http));
        } else {
            tracing::warn!("collecteur active mais RIOT_API_KEY absente : collecteur non demarre");
        }
    } else {
        tracing::info!("collecteur desactive (NEX_COLLECTOR=on pour l'activer)");
    }
    let app = routes::router(state);

    let listener = match tokio::net::TcpListener::bind(config.bind).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("impossible d'ecouter sur {} : {e}", config.bind);
            std::process::exit(2);
        }
    };
    tracing::info!("backend NEX pret sur http://{}", config.bind);
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serveur HTTP");
}
