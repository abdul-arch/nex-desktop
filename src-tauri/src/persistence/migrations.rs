//! Migrations SQLite versionnees par `PRAGMA user_version`.
//! Regle : ne jamais modifier une migration publiee, en ajouter une nouvelle.

use crate::error::{AppError, AppResult};
use rusqlite::Connection;

const MIGRATIONS: &[&str] = &[
    // v1 : preferences, favoris, recherches recentes, cache HTTP borne.
    r#"
    CREATE TABLE settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
    );

    CREATE TABLE favorites (
        id          INTEGER PRIMARY KEY,
        game_name   TEXT NOT NULL COLLATE NOCASE,
        tag_line    TEXT NOT NULL COLLATE NOCASE,
        platform    TEXT NOT NULL,
        puuid       TEXT,
        created_at  INTEGER NOT NULL,
        UNIQUE (game_name, tag_line, platform)
    );

    CREATE TABLE recent_searches (
        id          INTEGER PRIMARY KEY,
        game_name   TEXT NOT NULL COLLATE NOCASE,
        tag_line    TEXT NOT NULL COLLATE NOCASE,
        platform    TEXT NOT NULL,
        searched_at INTEGER NOT NULL,
        UNIQUE (game_name, tag_line, platform)
    );

    CREATE TABLE http_cache (
        key         TEXT PRIMARY KEY,
        body        TEXT NOT NULL,
        fetched_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL
    );
    "#,
    // v2 : disposition des widgets d'overlay (positions en fraction de l'ecran).
    r#"
    CREATE TABLE overlay_widgets (
        id       TEXT PRIMARY KEY,
        x        REAL NOT NULL,
        y        REAL NOT NULL,
        scale    REAL NOT NULL,
        opacity  REAL NOT NULL,
        visible  INTEGER NOT NULL,
        locked   INTEGER NOT NULL
    );
    "#,
    // v3 : index des enregistrements (clips et parties completes). Les videos restent sur disque.
    r#"
    CREATE TABLE recordings (
        id           INTEGER PRIMARY KEY,
        kind         TEXT NOT NULL,
        title        TEXT NOT NULL,
        path         TEXT NOT NULL UNIQUE,
        thumb        TEXT,
        champion_key TEXT,
        game_mode    TEXT,
        kda          TEXT,
        duration_ms  INTEGER NOT NULL,
        size_bytes   INTEGER NOT NULL,
        created_at   INTEGER NOT NULL,
        favorite     INTEGER NOT NULL DEFAULT 0,
        markers      TEXT NOT NULL DEFAULT '[]',
        complete     INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX recordings_created ON recordings(created_at DESC);
    "#,
    // v4 : base editoriale locale des augments ARAM Mayhem (regles JSON validees, jamais executees).
    r#"
    CREATE TABLE mayhem_rules (
        key         TEXT PRIMARY KEY,
        rule        TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    "#,
];

pub fn latest_version() -> i64 {
    MIGRATIONS.len() as i64
}

pub fn current_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

pub fn run(conn: &Connection) -> AppResult<()> {
    let current = current_version(conn)?;
    if current > latest_version() {
        return Err(AppError::Storage(format!(
            "base locale v{current} plus recente que l'application (v{})",
            latest_version()
        )));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate() {
        let version = index as i64 + 1;
        if version <= current {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {version}"))?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        run(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
    }

    #[test]
    fn refuses_newer_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA user_version = 999").unwrap();
        assert!(run(&conn).is_err());
    }
}
