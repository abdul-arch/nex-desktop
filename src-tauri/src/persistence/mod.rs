//! Persistance locale SQLite (fichier unique dans le dossier de donnees NEX).

pub mod cache;
pub mod migrations;
pub mod overlay;
pub mod players;
pub mod recordings;
pub mod settings;

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        // journal_mode renvoie une ligne : query_row plutot que execute.
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -2048;   -- cache de pages borne a ~2 MiB
             PRAGMA temp_store = MEMORY;",
        )?;
        migrations::run(&conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    /// Execute `f` avec la connexion. Ne jamais garder le verrou a travers un `.await`.
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self
            .0
            .lock()
            .map_err(|_| AppError::Storage("verrou de base corrompu".into()))?;
        f(&conn)
    }
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
