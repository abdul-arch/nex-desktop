//! Cache SQLite du backend : reponses Riot normalisees, avec TTL ou immuables (matchs).

use crate::error::BResult;
use nex_domain::api::RankSnapshotDto;
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub struct Store(Mutex<Connection>);

pub struct Cached {
    pub body: String,
    pub fetched_at: i64,
    pub fresh: bool,
}

impl Store {
    pub fn open(path: &Path) -> BResult<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn memory() -> BResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> BResult<Self> {
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
        conn.execute_batch(
            "PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS cache (
                 key        TEXT PRIMARY KEY,
                 body       TEXT NOT NULL,
                 fetched_at INTEGER NOT NULL,
                 expires_at INTEGER          -- NULL = immuable (match, timeline)
             );
             CREATE INDEX IF NOT EXISTS cache_expires ON cache(expires_at);
             -- Releves de rang : Riot ne donne que le rang courant, l'historique n'existe
             -- que par ce que NEX a observe. Une ligne par changement, jamais de doublon.
             CREATE TABLE IF NOT EXISTS rank_snapshots (
                 platform TEXT    NOT NULL,
                 puuid    TEXT    NOT NULL,
                 queue    TEXT    NOT NULL,
                 at       INTEGER NOT NULL,
                 tier     TEXT    NOT NULL,
                 division TEXT,
                 lp       INTEGER NOT NULL,
                 wins     INTEGER NOT NULL,
                 losses   INTEGER NOT NULL,
                 PRIMARY KEY (platform, puuid, queue, at)
             );
             CREATE INDEX IF NOT EXISTS rank_snapshots_player ON rank_snapshots(platform, puuid, queue, at);",
        )?;
        Ok(Self(Mutex::new(conn)))
    }

    /// Enregistre un releve si le rang a change depuis le dernier connu. Rend true si une
    /// ligne a ete ajoutee. Un rang identique n'ecrit rien : l'horodatage du dernier releve
    /// reste celui de l'observation du changement, pas celui de la derniere lecture.
    pub fn put_rank(&self, platform: &str, puuid: &str, queue: &str, tier: &str, division: Option<&str>, lp: i32, wins: u32, losses: u32) -> BResult<bool> {
        let conn = self.conn();
        let last: Option<(i64, String, Option<String>, i32, u32, u32)> = conn
            .query_row(
                "SELECT at, tier, division, lp, wins, losses FROM rank_snapshots
                 WHERE platform = ?1 AND puuid = ?2 AND queue = ?3 ORDER BY at DESC LIMIT 1",
                params![platform, puuid, queue],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .optional()?;
        if last.as_ref().is_some_and(|l| l.1 == tier && l.2.as_deref() == division && l.3 == lp && l.4 == wins && l.5 == losses) {
            return Ok(false);
        }
        // `at` fait partie de la cle : deux observations dans la meme milliseconde
        // s'ecraseraient. On decale d'une milliseconde plutot que de perdre un releve.
        let at = last.map_or_else(now_ms, |l| now_ms().max(l.0 + 1));
        conn.execute(
            "INSERT OR REPLACE INTO rank_snapshots (platform, puuid, queue, at, tier, division, lp, wins, losses)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![platform, puuid, queue, at, tier, division, lp, wins, losses],
        )?;
        Ok(true)
    }

    /// Releves d'un joueur, du plus ancien au plus recent. `queue` vide = toutes les files.
    pub fn ranks(&self, platform: &str, puuid: &str, queue: &str, limit: u32) -> BResult<Vec<RankSnapshotDto>> {
        let conn = self.conn();
        let mut st = conn.prepare(
            "SELECT at, queue, tier, division, lp, wins, losses FROM rank_snapshots
             WHERE platform = ?1 AND puuid = ?2 AND (?3 = '' OR queue = ?3) ORDER BY at DESC LIMIT ?4",
        )?;
        let rows = st.query_map(params![platform, puuid, queue, limit], |r| {
            Ok(RankSnapshotDto {
                at: r.get(0)?,
                queue: r.get(1)?,
                tier: r.get(2)?,
                division: r.get(3)?,
                lp: r.get(4)?,
                wins: r.get(5)?,
                losses: r.get(6)?,
            })
        })?;
        let mut out = rows.collect::<Result<Vec<_>, _>>()?;
        out.reverse();
        Ok(out)
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Acces direct a la connexion (module analytique). Ne pas garder a travers un `.await`.
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> BResult<T>) -> BResult<T> {
        f(&self.conn())
    }

    pub fn get(&self, key: &str) -> BResult<Option<Cached>> {
        let now = now_ms();
        Ok(self
            .conn()
            .query_row("SELECT body, fetched_at, expires_at FROM cache WHERE key = ?1", params![key], |r| {
                let exp: Option<i64> = r.get(2)?;
                Ok(Cached { body: r.get(0)?, fetched_at: r.get(1)?, fresh: exp.is_none_or(|e| e > now) })
            })
            .optional()?)
    }

    /// `ttl_ms = None` : entree immuable.
    pub fn put(&self, key: &str, body: &str, ttl_ms: Option<i64>) -> BResult<()> {
        let now = now_ms();
        self.conn().execute(
            "INSERT INTO cache (key, body, fetched_at, expires_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
            params![key, body, now, ttl_ms.map(|t| now + t)],
        )?;
        Ok(())
    }

    /// Supprime les entrees a TTL expirees depuis plus de 24 h.
    pub fn purge(&self) -> BResult<usize> {
        Ok(self.conn().execute(
            "DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at < ?1",
            params![now_ms() - 24 * 3600 * 1000],
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_and_immutable() {
        let s = Store::memory().unwrap();
        s.put("a", "1", Some(60_000)).unwrap();
        s.put("b", "2", None).unwrap();
        s.put("c", "3", Some(-1)).unwrap();
        assert!(s.get("a").unwrap().unwrap().fresh);
        assert!(s.get("b").unwrap().unwrap().fresh);
        assert!(!s.get("c").unwrap().unwrap().fresh);
        assert!(s.get("z").unwrap().is_none());
    }

    #[test]
    fn rank_snapshots_only_on_change() {
        let s = Store::memory().unwrap();
        let put = |lp: i32, wins: u32| s.put_rank("euw1", "p1", "RANKED_SOLO_5x5", "MASTER", None, lp, wins, 10).unwrap();
        assert!(put(30, 5), "le premier releve est toujours enregistre");
        assert!(!put(30, 5), "un rang identique n'ajoute pas de ligne");
        assert!(put(45, 6));
        // Une victoire sans gain de LP reste un changement : le bilan V/D a bouge.
        assert!(put(45, 7));

        let all = s.ranks("euw1", "p1", "RANKED_SOLO_5x5", 100).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all[0].at <= all[1].at, "du plus ancien au plus recent");
        assert_eq!(all[2].lp, 45);
        // Une autre file et un autre joueur ne se melangent pas.
        assert!(s.ranks("euw1", "p1", "RANKED_FLEX_SR", 100).unwrap().is_empty());
        assert!(s.ranks("euw1", "autre", "", 100).unwrap().is_empty());
        assert_eq!(s.ranks("euw1", "p1", "", 100).unwrap().len(), 3);
    }
}
