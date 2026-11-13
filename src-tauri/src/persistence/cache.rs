//! Cache disque des reponses HTTP publiques (TTL + quota d'entrees + purge).

use super::now_secs;
use crate::error::AppResult;
use rusqlite::{Connection, OptionalExtension, params};

/// Quota d'entrees : la purge supprime les plus anciennes au-dela.
pub const MAX_ENTRIES: i64 = 2_000;
/// Taille maximale d'une entree (octets) : evite de stocker une reponse aberrante.
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

pub struct CacheEntry {
    pub body: String,
    pub fetched_at: i64,
    pub fresh: bool,
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<CacheEntry>> {
    let now = now_secs();
    Ok(conn
        .query_row(
            "SELECT body, fetched_at, expires_at FROM http_cache WHERE key = ?1",
            params![key],
            |r| {
                let expires: i64 = r.get(2)?;
                Ok(CacheEntry {
                    body: r.get(0)?,
                    fetched_at: r.get(1)?,
                    fresh: expires > now,
                })
            },
        )
        .optional()?)
}

pub fn put(conn: &Connection, key: &str, body: &str, ttl_secs: i64) -> AppResult<()> {
    if body.len() > MAX_BODY_BYTES {
        return Ok(());
    }
    let now = now_secs();
    conn.execute(
        "INSERT INTO http_cache (key, body, fetched_at, expires_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
        params![key, body, now, now + ttl_secs],
    )?;
    Ok(())
}

/// Supprime les entrees expirees depuis plus de 7 jours puis applique le quota.
pub fn purge(conn: &Connection) -> AppResult<usize> {
    let stale_before = now_secs() - 7 * 24 * 3600;
    let mut removed = conn.execute(
        "DELETE FROM http_cache WHERE expires_at < ?1",
        params![stale_before],
    )?;
    removed += conn.execute(
        "DELETE FROM http_cache WHERE key NOT IN
           (SELECT key FROM http_cache ORDER BY fetched_at DESC LIMIT ?1)",
        params![MAX_ENTRIES],
    )?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;

    #[test]
    fn put_get_and_expiry() {
        let db = Db::open_in_memory().unwrap();
        db.with(|c| put(c, "k", "v", 60)).unwrap();
        let e = db.with(|c| get(c, "k")).unwrap().unwrap();
        assert!(e.fresh);
        db.with(|c| put(c, "k", "v2", -1)).unwrap();
        let e = db.with(|c| get(c, "k")).unwrap().unwrap();
        assert!(!e.fresh);
        assert_eq!(e.body, "v2");
        assert!(db.with(|c| get(c, "absent")).unwrap().is_none());
    }
}
