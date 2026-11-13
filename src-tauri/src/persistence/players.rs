//! Favoris et recherches recentes (persistants, bornes).

use super::now_secs;
use nex_domain::riot::{Platform, RiotId};
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use serde::Serialize;

pub const MAX_FAVORITES: i64 = 100;
pub const MAX_RECENT: i64 = 20;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedPlayer {
    pub id: i64,
    pub game_name: String,
    pub tag_line: String,
    pub platform: String,
    /// Horodatage Unix (secondes) : ajout du favori ou derniere recherche.
    pub at: i64,
}

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<SavedPlayer> {
    Ok(SavedPlayer {
        id: r.get(0)?,
        game_name: r.get(1)?,
        tag_line: r.get(2)?,
        platform: r.get(3)?,
        at: r.get(4)?,
    })
}

pub fn list_favorites(conn: &Connection) -> AppResult<Vec<SavedPlayer>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, game_name, tag_line, platform, created_at FROM favorites ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn add_favorite(conn: &Connection, id: &RiotId, platform: Platform) -> AppResult<Vec<SavedPlayer>> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM favorites", [], |r| r.get(0))?;
    if count >= MAX_FAVORITES {
        return Err(AppError::InvalidInput(format!(
            "limite de {MAX_FAVORITES} favoris atteinte"
        )));
    }
    conn.execute(
        "INSERT OR IGNORE INTO favorites (game_name, tag_line, platform, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id.game_name, id.tag_line, platform.code(), now_secs()],
    )?;
    list_favorites(conn)
}

pub fn remove_favorite(conn: &Connection, id: i64) -> AppResult<Vec<SavedPlayer>> {
    conn.execute("DELETE FROM favorites WHERE id = ?1", params![id])?;
    list_favorites(conn)
}

pub fn list_recent(conn: &Connection) -> AppResult<Vec<SavedPlayer>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, game_name, tag_line, platform, searched_at FROM recent_searches ORDER BY searched_at DESC, id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![MAX_RECENT], map_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn push_recent(conn: &Connection, id: &RiotId, platform: Platform) -> AppResult<Vec<SavedPlayer>> {
    conn.execute(
        "INSERT INTO recent_searches (game_name, tag_line, platform, searched_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(game_name, tag_line, platform) DO UPDATE SET searched_at = excluded.searched_at",
        params![id.game_name, id.tag_line, platform.code(), now_secs()],
    )?;
    conn.execute(
        "DELETE FROM recent_searches WHERE id NOT IN
           (SELECT id FROM recent_searches ORDER BY searched_at DESC, id DESC LIMIT ?1)",
        params![MAX_RECENT],
    )?;
    list_recent(conn)
}

pub fn clear_recent(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM recent_searches", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;

    #[test]
    fn favorites_are_unique_case_insensitive() {
        let db = Db::open_in_memory().unwrap();
        let a = RiotId::parse("Player#EUW").unwrap();
        let b = RiotId::parse("player#euw").unwrap();
        db.with(|c| add_favorite(c, &a, Platform::Euw1)).unwrap();
        let list = db.with(|c| add_favorite(c, &b, Platform::Euw1)).unwrap();
        assert_eq!(list.len(), 1);
        let list = db.with(|c| remove_favorite(c, list[0].id)).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn recent_searches_are_capped() {
        let db = Db::open_in_memory().unwrap();
        for i in 0..(MAX_RECENT + 5) {
            let id = RiotId::new(&format!("Joueur{i:03}"), "EUW").unwrap();
            db.with(|c| push_recent(c, &id, Platform::Euw1)).unwrap();
        }
        let list = db.with(list_recent).unwrap();
        assert_eq!(list.len() as i64, MAX_RECENT);
        let total: i64 = db
            .with(|c| Ok(c.query_row("SELECT COUNT(*) FROM recent_searches", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(total, MAX_RECENT);
    }
}
