//! Client Riot : cle cote serveur, limites de debit, concurrence bornee,
//! deduplication des appels identiques et cache SQLite.
//!
//! Deux priorites se partagent le quota de la cle (voir `limiter`) : les requetes des
//! visiteurs passent toujours, le collecteur n'emet que si la reserve reste libre.

use crate::error::{BResult, BackendError};
use crate::limiter::{Priority, RateLimiter};
use crate::store::Store;
use reqwest::{StatusCode, Url};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Semaphore};

/// Duree de vie en cache selon la nature de la donnee.
#[derive(Clone, Copy, Debug)]
pub enum Freshness {
    /// Donnee immuable (match termine, timeline).
    Immutable,
    Ttl(Duration),
}

pub struct RiotClient {
    http: reqwest::Client,
    key: Option<String>,
    limiter: RateLimiter,
    concurrency: Semaphore,
    store: Arc<Store>,
    inflight: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl RiotClient {
    /// `reserve` : requetes de la plus grande fenetre que le collecteur laisse toujours
    /// libres aux visiteurs (`NEX_COLLECTOR_RESERVE`).
    pub fn new(key: Option<String>, limits: &[(u32, u64)], reserve: u32, max_concurrency: usize, store: Arc<Store>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("NEX-Backend/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .expect("client HTTP");
        Self {
            http,
            key,
            limiter: RateLimiter::new(limits, reserve),
            concurrency: Semaphore::new(max_concurrency),
            store,
            inflight: Mutex::new(HashMap::new()),
        }
    }

    pub fn key_configured(&self) -> bool {
        self.key.is_some()
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// URL `https://{host}.api.riotgames.com/...` ; chaque segment est encode (pas d'injection de chemin).
    pub fn url(host: &str, segments: &[&str], query: &[(&str, String)]) -> BResult<Url> {
        let mut url = Url::parse(&format!("https://{host}.api.riotgames.com/"))
            .map_err(|_| BackendError::Internal(format!("hote invalide : {host}")))?;
        url.path_segments_mut()
            .map_err(|_| BackendError::Internal("url".into()))?
            .pop_if_empty()
            .extend(segments);
        if !query.is_empty() {
            let mut q = url.query_pairs_mut();
            for (k, v) in query {
                q.append_pair(k, v);
            }
        }
        Ok(url)
    }

    /// Attente maximale d'un jeton. Un visiteur ne patiente pas plus de 8 s : il recoit alors
    /// un 429 avec `retryAfterSecs`. Le collecteur, lui, a deja attendu sa place avec
    /// `wait_background_slot` ; s'il n'a plus de jeton, un visiteur vient de passer devant,
    /// et il relache vite la main pour ne pas retenir le verrou de deduplication.
    fn max_wait(priority: Priority) -> Duration {
        match priority {
            Priority::Interactive => Duration::from_secs(8),
            Priority::Background => Duration::from_secs(2),
        }
    }

    /// Attend que le collecteur ait le droit d'emettre : reserve des visiteurs libre, aucune
    /// pause, aucun blocage Riot. Ne prend pas de jeton. A appeler AVANT `get_cached_as`,
    /// hors du verrou de deduplication : un visiteur qui demande la meme ressource ne doit
    /// pas attendre derriere la patience du collecteur.
    pub async fn wait_background_slot(&self) {
        while let Some(wait) = self.limiter.delay(Priority::Background).await {
            tracing::debug!(attente_ms = wait.as_millis() as u64, "collecteur : reserve des visiteurs prise, il attend");
            tokio::time::sleep(wait).await;
        }
    }

    /// GET JSON brut avec cache. `bypass_ttl` ignore un cache encore frais (actualisation),
    /// sauf s'il a moins de 30 s.
    pub async fn get_cached(&self, cache_key: &str, url: Url, fresh: Freshness, bypass_ttl: bool) -> BResult<String> {
        self.get_cached_with(cache_key, url, fresh, bypass_ttl, Ok).await
    }

    /// Comme `get_cached`, mais `transform` (normalisation) est applique avant la mise en cache :
    /// on stocke la forme NEX compacte plutot que la reponse Riot brute.
    pub async fn get_cached_with(
        &self,
        cache_key: &str,
        url: Url,
        fresh: Freshness,
        bypass_ttl: bool,
        transform: impl FnOnce(String) -> BResult<String>,
    ) -> BResult<String> {
        self.get_cached_as(Priority::Interactive, cache_key, url, fresh, bypass_ttl, transform).await
    }

    /// Comme `get_cached_with`, avec la priorite de l'appelant : les routes HTTP sont
    /// interactives, le collecteur passe en `Background`.
    pub async fn get_cached_as(
        &self,
        priority: Priority,
        cache_key: &str,
        url: Url,
        fresh: Freshness,
        bypass_ttl: bool,
        transform: impl FnOnce(String) -> BResult<String>,
    ) -> BResult<String> {
        let usable = |c: &crate::store::Cached| {
            c.fresh && (!bypass_ttl || crate::store::now_ms() - c.fetched_at < 30_000)
        };
        if let Some(c) = self.store.get(cache_key)? {
            if usable(&c) {
                return Ok(c.body);
            }
        }

        // Deduplication : une seule requete Riot par cle a la fois.
        let lock = {
            let mut map = self.inflight.lock().await;
            map.entry(cache_key.to_string()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
        };
        let result = {
            let _guard = lock.lock().await;
            match self.store.get(cache_key)? {
                Some(c) if usable(&c) => Ok(c.body),
                stale => match self.fetch(url, priority).await.and_then(transform) {
                    Ok(body) => {
                        let ttl = match fresh {
                            Freshness::Immutable => None,
                            Freshness::Ttl(d) => Some(d.as_millis() as i64),
                        };
                        self.store.put(cache_key, &body, ttl)?;
                        Ok(body)
                    }
                    // Panne Riot : on sert la derniere valeur connue plutot que rien.
                    Err(BackendError::Upstream(msg)) => match stale {
                        Some(c) => {
                            tracing::warn!("Riot indisponible ({msg}), cache expire servi pour {cache_key}");
                            Ok(c.body)
                        }
                        None => Err(BackendError::Upstream(msg)),
                    },
                    Err(e) => Err(e),
                },
            }
        };
        {
            let mut map = self.inflight.lock().await;
            if map.get(cache_key).is_some_and(|l| Arc::strong_count(l) <= 2) {
                map.remove(cache_key);
            }
        }
        result
    }

    async fn fetch(&self, url: Url, priority: Priority) -> BResult<String> {
        let key = self
            .key
            .as_deref()
            .ok_or_else(|| BackendError::Unavailable("RIOT_API_KEY non configuree sur le backend".into()))?;
        let path = url.path().to_string();

        if let Err(wait) = self.limiter.acquire(priority, Self::max_wait(priority)).await {
            if priority == Priority::Interactive {
                // Un visiteur a attendu 8 s sans jeton : la fenetre est pleine. Le collecteur
                // se tait le temps qu'elle se vide, pour que le nouvel essai du visiteur passe.
                self.limiter.pause_background(wait).await;
                tracing::info!(attente = secs_annoncees(wait), %path, "fenetre locale pleine pour un visiteur : collecteur en pause");
            }
            return Err(BackendError::RateLimited(secs_annoncees(wait)));
        }
        let _permit = self
            .concurrency
            .acquire()
            .await
            .map_err(|_| BackendError::Internal("semaphore fermee".into()))?;

        let resp = self
            .http
            .get(url)
            .header("X-Riot-Token", key)
            .send()
            .await
            .map_err(|e| BackendError::Upstream(if e.is_timeout() { "delai Riot depasse".into() } else { "Riot injoignable".into() }))?;

        let status = resp.status();
        tracing::debug!(%status, %path, priorite = ?priority, "appel Riot");
        match status {
            s if s.is_success() => resp.text().await.map_err(|_| BackendError::Upstream("lecture de la reponse Riot".into())),
            StatusCode::NOT_FOUND => Err(BackendError::NotFound("introuvable chez Riot".into())),
            StatusCode::BAD_REQUEST => Err(BackendError::InvalidInput("requete refusee par Riot".into())),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(BackendError::Unavailable(
                "cle Riot refusee ou expiree (une cle de developpement expire apres 24 h)".into(),
            )),
            StatusCode::TOO_MANY_REQUESTS => {
                let retry = resp
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(10)
                    .clamp(1, 600);
                // application | method | service : indique quelle limite Riot a ete atteinte.
                let kind = resp
                    .headers()
                    .get("x-rate-limit-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("inconnu")
                    .to_string();
                // Riot a dit stop : plus personne n'emet pendant Retry-After. Si c'est un
                // visiteur qui l'a essuye, le collecteur se tait encore autant apres la levee,
                // le temps que le navigateur reessaie.
                self.limiter.block_for(Duration::from_secs(retry)).await;
                if priority == Priority::Interactive {
                    self.limiter.pause_background(Duration::from_secs(retry)).await;
                }
                tracing::warn!(retry, limite = %kind, priorite = ?priority, %path, "429 Riot : blocage temporaire");
                Err(BackendError::RateLimited(retry))
            }
            s => Err(BackendError::Upstream(format!("Riot a repondu {}", s.as_u16()))),
        }
    }
}

/// Secondes annoncees au client (`retryAfterSecs`), arrondies vers le haut : un essai une
/// seconde trop tot retombe sur la meme fenetre pleine.
fn secs_annoncees(d: Duration) -> u64 {
    (d.as_secs() + u64::from(d.subsec_nanos() > 0)).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_segments_are_encoded() {
        let u = RiotClient::url("europe", &["riot", "account", "v1", "accounts", "by-riot-id", "Élo die", "EUW"], &[]).unwrap();
        assert_eq!(u.as_str(), "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/%C3%89lo%20die/EUW");
        let u = RiotClient::url("europe", &["x", "../../admin"], &[("count", "5".into())]).unwrap();
        assert!(u.as_str().contains("..%2F..%2Fadmin"));
        assert!(u.as_str().ends_with("?count=5"));
    }

    #[tokio::test]
    async fn no_key_is_unavailable() {
        let store = Arc::new(Store::memory().unwrap());
        let c = RiotClient::new(None, &[(10, 1)], 0, 1, store);
        let url = RiotClient::url("europe", &["x"], &[]).unwrap();
        let err = c.get_cached("k", url, Freshness::Immutable, false).await.unwrap_err();
        assert!(matches!(err, BackendError::Unavailable(_)));
    }

    #[tokio::test]
    async fn serves_cache_without_key() {
        let store = Arc::new(Store::memory().unwrap());
        store.put("k", "{\"ok\":1}", None).unwrap();
        let c = RiotClient::new(None, &[(10, 1)], 0, 1, store);
        let url = RiotClient::url("europe", &["x"], &[]).unwrap();
        assert_eq!(c.get_cached("k", url, Freshness::Immutable, false).await.unwrap(), "{\"ok\":1}");
    }

    /// Le collecteur attend sa place avant d'emettre, et cette attente ne prend aucun jeton :
    /// les dix de la fenetre restent aux visiteurs.
    #[tokio::test]
    async fn le_collecteur_attend_sa_place_sans_prendre_de_jeton() {
        let store = Arc::new(Store::memory().unwrap());
        let c = RiotClient::new(None, &[(10, 60)], 2, 1, store);
        c.limiter.pause_background(Duration::from_millis(200)).await;
        let t = std::time::Instant::now();
        c.wait_background_slot().await;
        assert!(t.elapsed() >= Duration::from_millis(190), "a attendu {:?}", t.elapsed());
        for i in 0..10 {
            assert!(c.limiter.try_acquire(Priority::Interactive).await.is_none(), "jeton visiteur {}", i + 1);
        }
    }

    #[test]
    fn retry_after_arrondi_vers_le_haut() {
        assert_eq!(secs_annoncees(Duration::from_millis(19_800)), 20);
        assert_eq!(secs_annoncees(Duration::from_secs(19)), 19);
        assert_eq!(secs_annoncees(Duration::from_millis(10)), 1);
    }
}
