//! Index local des enregistrements (les fichiers video restent dans le dossier NEX de Videos).

use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    /// Position dans la video (ms).
    pub t_ms: i64,
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: i64,
    /// clip | full
    pub kind: String,
    pub title: String,
    pub path: String,
    pub thumb: Option<String>,
    pub champion_key: Option<String>,
    pub game_mode: Option<String>,
    pub kda: Option<String>,
    pub duration_ms: i64,
    pub size_bytes: i64,
    pub created_at: i64,
    pub favorite: bool,
    pub markers: Vec<Marker>,
    pub complete: bool,
}

pub struct NewRecording<'a> {
    pub kind: &'a str,
    pub title: &'a str,
    pub path: &'a str,
    pub thumb: Option<&'a str>,
    pub champion_key: Option<&'a str>,
    pub game_mode: Option<&'a str>,
    pub kda: Option<&'a str>,
    pub duration_ms: i64,
    pub size_bytes: i64,
    pub created_at: i64,
    pub markers: &'a [Marker],
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Recording> {
    let markers: String = r.get(12)?;
    Ok(Recording {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        path: r.get(3)?,
        thumb: r.get(4)?,
        champion_key: r.get(5)?,
        game_mode: r.get(6)?,
        kda: r.get(7)?,
        duration_ms: r.get(8)?,
        size_bytes: r.get(9)?,
        created_at: r.get(10)?,
        favorite: r.get::<_, i64>(11)? != 0,
        markers: serde_json::from_str(&markers).unwrap_or_default(),
        complete: r.get::<_, i64>(13)? != 0,
    })
}

const COLS: &str = "id, kind, title, path, thumb, champion_key, game_mode, kda, duration_ms, size_bytes, created_at, favorite, markers, complete";

pub fn insert(conn: &Connection, n: &NewRecording<'_>) -> AppResult<Recording> {
    if !matches!(n.kind, "clip" | "full") {
        return Err(AppError::InvalidInput("type d'enregistrement inconnu".into()));
    }
    conn.execute(
        "INSERT INTO recordings (kind, title, path, thumb, champion_key, game_mode, kda, duration_ms, size_bytes, created_at, markers)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![n.kind, n.title, n.path, n.thumb, n.champion_key, n.game_mode, n.kda, n.duration_ms, n.size_bytes, n.created_at, serde_json::to_string(n.markers)?],
    )?;
    get(conn, conn.last_insert_rowid())?.ok_or_else(|| AppError::Storage("insertion".into()))
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Option<Recording>> {
    Ok(conn.query_row(&format!("SELECT {COLS} FROM recordings WHERE id = ?1"), params![id], row).optional()?)
}

pub fn list(conn: &Connection) -> AppResult<Vec<Recording>> {
    let mut stmt = conn.prepare_cached(&format!("SELECT {COLS} FROM recordings ORDER BY created_at DESC, id DESC LIMIT 2000"))?;
    let rows = stmt.query_map([], row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn set_favorite(conn: &Connection, id: i64, favorite: bool) -> AppResult<Option<Recording>> {
    conn.execute("UPDATE recordings SET favorite = ?2 WHERE id = ?1", params![id, favorite as i64])?;
    get(conn, id)
}

pub fn remove(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM recordings WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn total_bytes(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COALESCE(SUM(size_bytes), 0) FROM recordings", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;

    #[test]
    fn insert_list_favorite_remove() {
        let db = Db::open_in_memory().unwrap();
        let m = vec![Marker { t_ms: 1500, kind: "kill".into(), label: "Élimination".into() }];
        let n = NewRecording {
            kind: "clip",
            title: "Triple kill",
            path: "C:/v/a.mp4",
            thumb: None,
            champion_key: Some("Ahri"),
            game_mode: Some("CLASSIC"),
            kda: Some("3/0/1"),
            duration_ms: 20_000,
            size_bytes: 1000,
            created_at: 1,
            markers: &m,
        };
        let r = db.with(|c| insert(c, &n)).unwrap();
        assert_eq!(r.markers, m);
        assert!(db.with(|c| insert(c, &NewRecording { kind: "evil", ..n })).is_err());
        let r = db.with(|c| set_favorite(c, r.id, true)).unwrap().unwrap();
        assert!(r.favorite);
        assert_eq!(db.with(total_bytes).unwrap(), 1000);
        db.with(|c| remove(c, r.id)).unwrap();
        assert!(db.with(list).unwrap().is_empty());
    }
}
