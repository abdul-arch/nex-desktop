//! Disposition des widgets d'overlay : position (fraction 0-1 de l'ecran), echelle, opacite,
//! visibilite et verrouillage, par widget.

use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

pub const WIDGETS: [&str; 5] = ["clock", "objectives", "build", "skills", "trinket"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetLayout {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub opacity: f64,
    pub visible: bool,
    pub locked: bool,
}

pub fn defaults() -> Vec<WidgetLayout> {
    let w = |id: &str, x: f64, y: f64, visible: bool| WidgetLayout { id: id.into(), x, y, scale: 1.0, opacity: 0.92, visible, locked: false };
    vec![
        w("clock", 0.01, 0.30, true),
        w("objectives", 0.44, 0.015, true),
        w("build", 0.80, 0.30, true),
        w("skills", 0.01, 0.62, true),
        w("trinket", 0.80, 0.55, false),
    ]
}

pub fn validate(w: &WidgetLayout) -> AppResult<()> {
    let in01 = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
    if !WIDGETS.contains(&w.id.as_str()) {
        return Err(AppError::InvalidInput("widget inconnu".into()));
    }
    if !in01(w.x) || !in01(w.y) || !(0.5..=2.0).contains(&w.scale) || !(0.2..=1.0).contains(&w.opacity) {
        return Err(AppError::InvalidInput("disposition hors limites".into()));
    }
    Ok(())
}

pub fn load(conn: &Connection) -> AppResult<Vec<WidgetLayout>> {
    let mut stmt = conn.prepare_cached("SELECT id, x, y, scale, opacity, visible, locked FROM overlay_widgets")?;
    let saved: Vec<WidgetLayout> = stmt
        .query_map([], |r| {
            Ok(WidgetLayout {
                id: r.get(0)?,
                x: r.get(1)?,
                y: r.get(2)?,
                scale: r.get(3)?,
                opacity: r.get(4)?,
                visible: r.get::<_, i64>(5)? != 0,
                locked: r.get::<_, i64>(6)? != 0,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(defaults()
        .into_iter()
        .map(|d| saved.iter().find(|s| s.id == d.id && validate(s).is_ok()).cloned().unwrap_or(d))
        .collect())
}

pub fn save(conn: &Connection, w: &WidgetLayout) -> AppResult<Vec<WidgetLayout>> {
    validate(w)?;
    conn.execute(
        "INSERT INTO overlay_widgets (id, x, y, scale, opacity, visible, locked) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET x = excluded.x, y = excluded.y, scale = excluded.scale, opacity = excluded.opacity,
           visible = excluded.visible, locked = excluded.locked",
        params![w.id, w.x, w.y, w.scale, w.opacity, w.visible as i64, w.locked as i64],
    )?;
    load(conn)
}

pub fn reset(conn: &Connection) -> AppResult<Vec<WidgetLayout>> {
    conn.execute("DELETE FROM overlay_widgets", [])?;
    load(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;

    #[test]
    fn save_validate_reset() {
        let db = Db::open_in_memory().unwrap();
        let mut w = defaults()[0].clone();
        w.x = 0.5;
        w.visible = false;
        let all = db.with(|c| save(c, &w)).unwrap();
        assert_eq!(all.len(), WIDGETS.len());
        assert_eq!(all[0].x, 0.5);
        assert!(!all[0].visible);
        let mut bad = w.clone();
        bad.x = 1.5;
        assert!(db.with(|c| save(c, &bad)).is_err());
        bad = w.clone();
        bad.id = "evil".into();
        assert!(db.with(|c| save(c, &bad)).is_err());
        let all = db.with(reset).unwrap();
        assert_eq!(all[0], defaults()[0]);
    }
}
