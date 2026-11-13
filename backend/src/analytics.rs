//! Statistiques agregees : ingestion des matchs collectes et requetes de tier list,
//! builds et matchups. Toutes les valeurs sont accompagnees de leur effectif.

use crate::error::{BResult, BackendError};
use crate::items::ItemClasses;
use crate::store::now_ms;
use nex_domain::api::*;
use rusqlite::{Connection, OptionalExtension, params};

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS a_matches (
    match_id     TEXT PRIMARY KEY,
    platform     TEXT NOT NULL,
    patch        TEXT NOT NULL,
    queue_id     INTEGER NOT NULL,
    tier         TEXT NOT NULL,
    started_at   INTEGER NOT NULL,
    duration     INTEGER NOT NULL,
    has_timeline INTEGER NOT NULL,
    ingested_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS a_matches_scope ON a_matches(queue_id, patch, platform, tier);
CREATE TABLE IF NOT EXISTS a_participants (
    match_id       TEXT NOT NULL,
    champion_id    INTEGER NOT NULL,
    team_id        INTEGER NOT NULL,
    position       TEXT NOT NULL,
    win            INTEGER NOT NULL,
    opponent_id    INTEGER,
    rune_page      TEXT,
    spells         TEXT,
    start_items    TEXT,
    core_items     TEXT,
    boots          INTEGER,
    late_items     TEXT,
    skill_priority TEXT,
    skill_start    TEXT,
    PRIMARY KEY (match_id, champion_id, team_id)
);
CREATE INDEX IF NOT EXISTS a_part_champ ON a_participants(champion_id, position);
-- Performances d'un participant, pour les medianes du Data Studio. Separee de
-- a_participants (qui ne porte que les builds) : les parties ingerees avant cette table
-- n'y figurent simplement pas, et la mediane dit son echantillon.
CREATE TABLE IF NOT EXISTS a_perf (
    match_id    TEXT    NOT NULL,
    champion_id INTEGER NOT NULL,
    team_id     INTEGER NOT NULL,
    position    TEXT    NOT NULL,
    win         INTEGER NOT NULL,
    minutes     REAL    NOT NULL,
    kills       INTEGER NOT NULL,
    deaths      INTEGER NOT NULL,
    assists     INTEGER NOT NULL,
    team_kills  INTEGER NOT NULL,
    cs          INTEGER NOT NULL,
    gold        INTEGER NOT NULL,
    damage      INTEGER NOT NULL,
    team_damage INTEGER NOT NULL,
    damage_taken INTEGER NOT NULL,
    vision      INTEGER NOT NULL,
    wards_placed INTEGER NOT NULL,
    wards_killed INTEGER NOT NULL,
    control_wards INTEGER NOT NULL,
    cc_time     INTEGER,
    time_dead   INTEGER,
    -- `challenges.turretPlatesTaken` de Riot : stocke, mais pas servi. Sur une partie
    -- observee la somme des dix joueurs atteignait 68 pour 30 plaques existantes, dont 25
    -- pour un seul joueur : ce nombre ne compte pas des plaques, et on ne l'affiche pas.
    plates      INTEGER,
    obj_damage  INTEGER,
    turret_damage INTEGER,
    solo_kills  INTEGER,
    gold_diff15 INTEGER,
    profile_icon INTEGER,
    PRIMARY KEY (match_id, champion_id, team_id)
);
CREATE INDEX IF NOT EXISTS a_perf_champ ON a_perf(champion_id, position);
CREATE TABLE IF NOT EXISTS a_bans (
    match_id    TEXT NOT NULL,
    champion_id INTEGER NOT NULL,
    PRIMARY KEY (match_id, champion_id)
);
"#;

pub const POSITIONS: [&str; 5] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
pub const TIERS: [&str; 3] = ["CHALLENGER", "GRANDMASTER", "MASTER"];
/// Echantillon minimal pour classer un champion ou afficher une variante sans avertissement.
pub const MIN_GAMES: u32 = 20;

pub fn init(conn: &Connection) -> BResult<()> {
    conn.execute_batch(SCHEMA)?;
    // Colonne ajoutee apres coup : une base creee avant ne l'a pas, et CREATE TABLE
    // IF NOT EXISTS ne la rattrape pas. L'erreur « duplicate column » est attendue.
    let _ = conn.execute("ALTER TABLE a_perf ADD COLUMN profile_icon INTEGER", []);
    Ok(())
}

/// "16.20.715.1234" -> "16.20"
pub fn patch_of(game_version: &str) -> Option<String> {
    let mut it = game_version.split('.');
    let (a, b) = (it.next()?, it.next()?);
    (a.chars().all(|c| c.is_ascii_digit()) && b.chars().all(|c| c.is_ascii_digit()) && !a.is_empty() && !b.is_empty())
        .then(|| format!("{a}.{b}"))
}

fn join(ids: &[u32]) -> String {
    ids.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
}

fn split(s: &str) -> Vec<u32> {
    s.split(',').filter_map(|x| x.parse().ok()).collect()
}

// ---------- Derivees de la timeline ----------

/// Ordre d'achat apres annulations (ITEM_UNDO), avec horodatage.
pub fn purchases(t: &TimelineDto, pid: u8) -> Vec<(u64, u32)> {
    let mut out: Vec<(u64, u32)> = Vec::new();
    for e in t.events.iter().filter(|e| e.participant_id == Some(pid)) {
        match e.kind.as_str() {
            "item_purchased" => {
                if let Some(id) = e.item_id.filter(|i| *i > 0) {
                    out.push((e.timestamp, id));
                }
            }
            "item_undo" => {
                let target = e.before_item_id.filter(|i| *i > 0);
                if let Some(target) = target {
                    if let Some(pos) = out.iter().rposition(|(_, id)| *id == target) {
                        out.remove(pos);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

pub fn skill_order(t: &TimelineDto, pid: u8) -> Vec<u8> {
    t.events
        .iter()
        .filter(|e| e.kind == "skill_level_up" && e.participant_id == Some(pid))
        .filter_map(|e| e.skill_slot.filter(|s| (1..=4).contains(s)))
        .collect()
}

/// Ordre dans lequel A/Z/E (1/2/3) atteignent le rang 5 ; ceux qui ne l'atteignent pas
/// sont classes par nombre de points. None si moins de 9 points (partie trop courte).
pub fn skill_priority(order: &[u8]) -> Option<Vec<u32>> {
    if order.len() < 9 {
        return None;
    }
    let mut counts = [0u32; 4];
    let mut maxed: Vec<u32> = Vec::new();
    for s in order {
        let i = (*s - 1) as usize;
        counts[i] += 1;
        if i < 3 && counts[i] == 5 {
            maxed.push(*s as u32);
        }
    }
    let mut rest: Vec<u32> = (1..=3u32).filter(|s| !maxed.contains(s)).collect();
    rest.sort_by_key(|s| std::cmp::Reverse(counts[(*s - 1) as usize]));
    maxed.extend(rest);
    Some(maxed)
}

// ---------- Ingestion ----------

/// Ingere un match (idempotent). Ignore les remakes, les parties < 5 min et hors Faille.
pub fn ingest(conn: &Connection, m: &MatchDto, t: Option<&TimelineDto>, tier: &str, items: &ItemClasses) -> BResult<bool> {
    if m.remake || m.duration_sec < 300 {
        return Ok(false);
    }
    let Some(patch) = patch_of(&m.game_version) else { return Ok(false) };
    if m.participants.len() != 10 || m.participants.iter().any(|p| p.position.is_none()) {
        return Ok(false);
    }
    let exists: Option<i64> = conn
        .query_row("SELECT 1 FROM a_matches WHERE match_id = ?1", params![m.id], |r| r.get(0))
        .optional()?;
    if exists.is_some() {
        return Ok(false);
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO a_matches (match_id, platform, patch, queue_id, tier, started_at, duration, has_timeline, ingested_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![m.id, m.platform, patch, m.queue_id, tier, m.started_at, m.duration_sec, t.is_some() as i32, now_ms()],
    )?;
    for team in &m.teams {
        for b in team.bans.iter().filter(|b| **b > 0) {
            tx.execute("INSERT OR IGNORE INTO a_bans (match_id, champion_id) VALUES (?1, ?2)", params![m.id, b])?;
        }
    }
    for p in &m.participants {
        let pos = p.position.clone().unwrap_or_default();
        let opponent = m
            .participants
            .iter()
            .find(|o| o.team_id != p.team_id && o.position.as_deref() == Some(pos.as_str()))
            .map(|o| o.champion_id);
        let rune_page = match (p.primary_style, p.secondary_style) {
            (Some(a), Some(b)) if p.perks.len() == 6 && p.stat_perks.len() == 3 => {
                let mut ids = vec![a];
                ids.extend_from_slice(&p.perks[..4]);
                ids.push(b);
                ids.extend_from_slice(&p.perks[4..]);
                ids.extend_from_slice(&p.stat_perks);
                Some(join(&ids))
            }
            _ => None,
        };
        let mut spells = p.spells.to_vec();
        spells.sort_unstable();

        let (mut start, mut core, mut boots, mut late, mut prio, mut sstart) = (None, None, None, None, None, None);
        if let Some(t) = t {
            let buys = purchases(t, p.participant_id);
            let mut st: Vec<u32> = buys.iter().filter(|(ts, _)| *ts <= 90_000).map(|(_, i)| *i).collect();
            st.sort_unstable();
            if !st.is_empty() {
                start = Some(join(&st));
            }
            let mut completed: Vec<u32> = Vec::new();
            for (_, id) in &buys {
                if items.completed.contains(id) && !completed.contains(id) {
                    completed.push(*id);
                }
            }
            if completed.len() >= 3 {
                core = Some(join(&completed[..3]));
            }
            if completed.len() > 3 {
                late = Some(serde_json::to_string(&completed[3..completed.len().min(6)])?);
            }
            boots = buys.iter().find(|(_, i)| items.boots.contains(i)).map(|(_, i)| *i);
            let order = skill_order(t, p.participant_id);
            prio = skill_priority(&order).map(|v| join(&v));
            if order.len() >= 3 {
                sstart = Some(join(&order[..3].iter().map(|x| *x as u32).collect::<Vec<_>>()));
            }
        }
        tx.execute(
            "INSERT OR IGNORE INTO a_participants
               (match_id, champion_id, team_id, position, win, opponent_id, rune_page, spells, start_items, core_items, boots, late_items, skill_priority, skill_start)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![m.id, p.champion_id, p.team_id, pos, p.win as i32, opponent, rune_page, join(&spells), start, core, boots, late, prio, sstart],
        )?;

        // Performances : ce qui alimente les medianes du Data Studio.
        let mates: Vec<&_> = m.participants.iter().filter(|o| o.team_id == p.team_id).collect();
        // Ecart d'or a 15:00 avec l'adversaire du meme poste, quand la timeline etait la.
        let gold_diff15 = m.gold_at_15.as_ref().and_then(|g| {
            let i = m.participants.iter().position(|o| o.participant_id == p.participant_id)?;
            let j = m.participants.iter().position(|o| o.team_id != p.team_id && o.position == p.position)?;
            Some(i64::from(*g.get(i)?) - i64::from(*g.get(j)?))
        });
        tx.execute(
            "INSERT OR IGNORE INTO a_perf
               (match_id, champion_id, team_id, position, win, minutes, kills, deaths, assists, team_kills, cs, gold,
                damage, team_damage, damage_taken, vision, wards_placed, wards_killed, control_wards,
                cc_time, time_dead, plates, obj_damage, turret_damage, solo_kills, gold_diff15, profile_icon)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)",
            params![
                m.id,
                p.champion_id,
                p.team_id,
                pos,
                p.win as i32,
                m.duration_sec as f64 / 60.0,
                p.kills,
                p.deaths,
                p.assists,
                mates.iter().map(|o| o.kills).sum::<u32>(),
                p.cs,
                p.gold_earned,
                p.damage_to_champions,
                mates.iter().map(|o| o.damage_to_champions).sum::<u32>(),
                p.damage_taken,
                p.vision_score,
                p.wards_placed,
                p.wards_killed,
                p.control_wards_bought,
                p.cc_time_sec,
                p.time_dead_sec,
                p.turret_plates,
                p.damage_to_objectives,
                p.damage_to_turrets,
                p.solo_kills,
                gold_diff15,
                p.profile_icon_id,
            ],
        )?;
    }
    tx.commit()?;
    Ok(true)
}

// ---------- Perimetre ----------

#[derive(Debug, Clone)]
pub struct Filter {
    pub patch: String,
    pub platform: String,
    pub queue_id: u32,
    pub tier: String,
}

impl Filter {
    /// Valide les parametres ; patch vide = dernier patch collecte.
    pub fn resolve(conn: &Connection, patch: Option<&str>, platform: Option<&str>, queue: Option<u32>, tier: Option<&str>) -> BResult<Self> {
        let queue_id = queue.unwrap_or(420);
        if ![420, 440].contains(&queue_id) {
            return Err(BackendError::InvalidInput("file non prise en charge (420 ou 440)".into()));
        }
        let platform = match platform.unwrap_or("all") {
            "all" => "all".to_string(),
            p => nex_domain::riot::Platform::parse(p)?.code().to_string(),
        };
        let tier = match tier.unwrap_or("all") {
            "all" => "all".to_string(),
            t if TIERS.contains(&t) => t.to_string(),
            _ => return Err(BackendError::InvalidInput("rang inconnu".into())),
        };
        let patch = match patch.unwrap_or("") {
            "" => latest_patch(conn, queue_id)?.unwrap_or_else(|| "all".into()),
            "all" => "all".into(),
            p if patch_of(&format!("{p}.0")).as_deref() == Some(p) => p.to_string(),
            _ => return Err(BackendError::InvalidInput("patch invalide (ex. 16.20)".into())),
        };
        Ok(Self { patch, platform, queue_id, tier })
    }

    const WHERE: &'static str =
        "m.queue_id = ?1 AND (?2 = 'all' OR m.patch = ?2) AND (?3 = 'all' OR m.platform = ?3) AND (?4 = 'all' OR m.tier = ?4)";

    fn scope(&self, conn: &Connection) -> BResult<StatsScopeDto> {
        let matches: u32 = conn.query_row(
            &format!("SELECT COUNT(*) FROM a_matches m WHERE {}", Self::WHERE),
            params![self.queue_id, self.patch, self.platform, self.tier],
            |r| r.get(0),
        )?;
        Ok(StatsScopeDto {
            patch: self.patch.clone(),
            platform: self.platform.clone(),
            queue_id: self.queue_id,
            tier: self.tier.clone(),
            matches,
        })
    }
}

// ---------- Medianes du Data Studio ----------

/// Mesures servies comme repere, avec l'expression SQL qui les calcule sur `a_perf`.
/// Les cles sont celles du catalogue cote interface (`src/domain/studio.ts`).
const BASELINE_STATS: [(&str, &str); 16] = [
    ("csPerMin", "p.cs / p.minutes"),
    ("damagePerMin", "p.damage / p.minutes"),
    ("damageTakenPerMin", "p.damage_taken / p.minutes"),
    ("goldPerMin", "p.gold / p.minutes"),
    ("visionPerMin", "p.vision / p.minutes"),
    ("killParticipation", "CASE WHEN p.team_kills > 0 THEN (p.kills + p.assists) * 1.0 / p.team_kills END"),
    ("damageShare", "CASE WHEN p.team_damage > 0 THEN p.damage * 1.0 / p.team_damage END"),
    ("kda", "(p.kills + p.assists) * 1.0 / MAX(1, p.deaths)"),
    ("killsPerGame", "p.kills * 1.0"),
    ("deathsPer10", "p.deaths * 10.0 / p.minutes"),
    ("soloKills", "p.solo_kills * 1.0"),
    ("ccTime", "p.cc_time * 1.0"),
    ("timeDead", "p.time_dead * 1.0"),
    ("objectiveDamage", "p.obj_damage * 1.0"),
    ("wardsPlacedPer10", "p.wards_placed * 10.0 / p.minutes"),
    ("goldDiff15", "p.gold_diff15 * 1.0"),
];

/// Echantillon minimal pour qu'un taux de victoire par icone veuille dire quelque chose.
const MIN_ICON_PLAYERS: u32 = 30;

/// Icones d'invocateur portees par les joueurs des parties collectees, de la plus vue a la
/// moins vue. Le taux de victoire n'est rendu qu'au-dela de `MIN_ICON_PLAYERS` porteurs :
/// en dessous il ne dirait rien, et une icone n'influence evidemment pas une partie.
pub fn icons(conn: &Connection, f: &Filter, limit: u32) -> BResult<IconsDto> {
    let sql = format!(
        "SELECT p.profile_icon, COUNT(*), SUM(p.win) FROM a_perf p JOIN a_matches m ON m.match_id = p.match_id
         WHERE {} AND p.profile_icon IS NOT NULL AND p.profile_icon > 0
         GROUP BY p.profile_icon ORDER BY COUNT(*) DESC LIMIT ?5",
        Filter::WHERE
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(params![f.queue_id, f.patch, f.platform, f.tier, limit], |r| {
        let (icon, players, wins): (i64, u32, u32) = (r.get(0)?, r.get(1)?, r.get(2)?);
        Ok(IconDto {
            icon_id: icon as u32,
            players,
            wins,
            win_rate: if players >= MIN_ICON_PLAYERS { Some(wins as f64 / players as f64) } else { None },
        })
    })?;
    let list = rows.collect::<Result<Vec<_>, _>>()?;
    let sample = list.iter().map(|i| i.players).sum();
    Ok(IconsDto { scope: f.scope(conn)?, sample, min_players: MIN_ICON_PLAYERS, icons: list })
}

/// Mediane de chaque mesure sur les parties collectees, et taille de l'echantillon.
/// Une mesure dont aucune ligne ne porte la donnee rend `median: None` : la colonne de
/// comparaison reste vide plutot que de montrer un chiffre tire de rien.
pub fn baselines(conn: &Connection, f: &Filter, position: Option<&str>) -> BResult<BaselinesDto> {
    let cols = BASELINE_STATS.iter().map(|(_, sql)| *sql).collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT {cols} FROM a_perf p JOIN a_matches m ON m.match_id = p.match_id
         WHERE {} AND (?5 = '' OR p.position = ?5)",
        Filter::WHERE
    );
    let mut st = conn.prepare(&sql)?;
    let pos = position.unwrap_or("");
    let mut cols_values: Vec<Vec<f64>> = vec![Vec::new(); BASELINE_STATS.len()];
    let mut rows = st.query(params![f.queue_id, f.patch, f.platform, f.tier, pos])?;
    let mut sample = 0u32;
    while let Some(r) = rows.next()? {
        sample += 1;
        for (i, bucket) in cols_values.iter_mut().enumerate() {
            if let Some(v) = r.get::<_, Option<f64>>(i)? {
                if v.is_finite() {
                    bucket.push(v);
                }
            }
        }
    }
    let stats = BASELINE_STATS
        .iter()
        .zip(cols_values.into_iter())
        .map(|((key, _), mut v)| {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            BaselineDto {
                key: (*key).to_string(),
                median: median(&v),
                games: v.len() as u32,
            }
        })
        .collect();
    Ok(BaselinesDto {
        position: pos.to_string(),
        sample,
        stats,
    })
}

/// Mediane d'une suite deja triee. `None` si elle est vide.
fn median(sorted: &[f64]) -> Option<f64> {
    match sorted.len() {
        0 => None,
        n if n % 2 == 1 => Some(sorted[n / 2]),
        n => Some((sorted[n / 2 - 1] + sorted[n / 2]) / 2.0),
    }
}

fn patch_key(p: &str) -> (u32, u32) {
    let mut it = p.split('.').map(|x| x.parse().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0))
}

fn latest_patch(conn: &Connection, queue_id: u32) -> BResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT DISTINCT patch FROM a_matches WHERE queue_id = ?1")?;
    let patches: Vec<String> = stmt.query_map(params![queue_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(patches.into_iter().max_by_key(|p| patch_key(p)))
}

pub fn meta(conn: &Connection, collector: CollectorStatusDto) -> BResult<StatsMetaDto> {
    let group = |col: &str| -> BResult<Vec<(String, u32)>> {
        let mut stmt = conn.prepare(&format!("SELECT {col}, COUNT(*) FROM a_matches GROUP BY {col}"))?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    };
    let mut patches = group("patch")?;
    patches.sort_by_key(|(p, _)| std::cmp::Reverse(patch_key(p)));
    let mut platforms = group("platform")?;
    platforms.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
    let tiers = group("tier")?;
    Ok(StatsMetaDto { patches, platforms, tiers, collector, min_games: MIN_GAMES })
}

// ---------- Tier list ----------

/// Retrait bayesien vers 50 % : (victoires + K/2) / (parties + K).
pub const SHRINK_K: f64 = 40.0;

pub fn adjusted_win_rate(wins: u32, games: u32) -> f64 {
    (wins as f64 + SHRINK_K / 2.0) / (games as f64 + SHRINK_K)
}

pub fn tier_of(adj: f64, games: u32) -> &'static str {
    if games < MIN_GAMES {
        return "?";
    }
    match adj {
        a if a >= 0.535 => "S+",
        a if a >= 0.52 => "S",
        a if a >= 0.505 => "A",
        a if a >= 0.49 => "B",
        a if a >= 0.475 => "C",
        _ => "D",
    }
}

pub fn tier_list(conn: &Connection, f: &Filter, position: Option<&str>) -> BResult<TierListDto> {
    let scope = f.scope(conn)?;
    let total = scope.matches.max(1) as f64;
    let mut bans_stmt = conn.prepare(&format!(
        "SELECT b.champion_id, COUNT(*) FROM a_bans b JOIN a_matches m ON m.match_id = b.match_id WHERE {} GROUP BY b.champion_id",
        Filter::WHERE
    ))?;
    let bans: std::collections::HashMap<i32, u32> = bans_stmt
        .query_map(params![f.queue_id, f.patch, f.platform, f.tier], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT p.champion_id, p.position, COUNT(*), SUM(p.win) FROM a_participants p JOIN a_matches m ON m.match_id = p.match_id
         WHERE {} AND (?5 = '' OR p.position = ?5) GROUP BY p.champion_id, p.position",
        Filter::WHERE
    ))?;
    let mut champions: Vec<ChampionStatDto> = stmt
        .query_map(params![f.queue_id, f.patch, f.platform, f.tier, position.unwrap_or("")], |r| {
            Ok((r.get::<_, i32>(0)?, r.get::<_, String>(1)?, r.get::<_, u32>(2)?, r.get::<_, u32>(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|(id, pos, games, wins)| {
            let adj = adjusted_win_rate(wins, games);
            ChampionStatDto {
                champion_id: id,
                position: pos,
                games,
                wins,
                pick_rate: games as f64 / total,
                ban_rate: *bans.get(&id).unwrap_or(&0) as f64 / total,
                adjusted_win_rate: adj,
                tier: tier_of(adj, games).to_string(),
            }
        })
        .collect();
    champions.sort_by(|a, b| b.adjusted_win_rate.total_cmp(&a.adjusted_win_rate).then(b.games.cmp(&a.games)));
    Ok(TierListDto { scope, champions })
}

// ---------- Build d'un champion ----------

fn variants(conn: &Connection, f: &Filter, champion: i32, position: &str, column: &str, limit: u32) -> BResult<Vec<VariantDto>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT p.{column}, COUNT(*), SUM(p.win) FROM a_participants p JOIN a_matches m ON m.match_id = p.match_id
         WHERE {} AND p.champion_id = ?5 AND p.position = ?6 AND p.{column} IS NOT NULL
         GROUP BY p.{column} ORDER BY COUNT(*) DESC, SUM(p.win) DESC LIMIT ?7",
        Filter::WHERE
    ))?;
    let rows = stmt.query_map(params![f.queue_id, f.patch, f.platform, f.tier, champion, position, limit], |r| {
        let key: rusqlite::types::Value = r.get(0)?;
        let ids = match key {
            rusqlite::types::Value::Text(s) => split(&s),
            rusqlite::types::Value::Integer(i) => vec![i as u32],
            _ => vec![],
        };
        Ok(VariantDto { ids, games: r.get(1)?, wins: r.get(2)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn champion_build(conn: &Connection, f: &Filter, champion: i32, position: Option<&str>) -> BResult<ChampionBuildDto> {
    let scope = f.scope(conn)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT p.position, COUNT(*) FROM a_participants p JOIN a_matches m ON m.match_id = p.match_id
         WHERE {} AND p.champion_id = ?5 GROUP BY p.position ORDER BY COUNT(*) DESC",
        Filter::WHERE
    ))?;
    let positions: Vec<(String, u32)> = stmt
        .query_map(params![f.queue_id, f.patch, f.platform, f.tier, champion], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let position = match position {
        Some(p) => p.to_string(),
        None => positions.first().map(|(p, _)| p.clone()).unwrap_or_else(|| "MIDDLE".into()),
    };
    let (games, wins, tl): (u32, u32, u32) = conn.query_row(
        &format!(
            "SELECT COUNT(*), COALESCE(SUM(p.win), 0), COALESCE(SUM(m.has_timeline), 0) FROM a_participants p JOIN a_matches m ON m.match_id = p.match_id
             WHERE {} AND p.champion_id = ?5 AND p.position = ?6",
            Filter::WHERE
        ),
        params![f.queue_id, f.patch, f.platform, f.tier, champion, position],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    let mut late_stmt = conn.prepare(&format!(
        "SELECT j.value, COUNT(*), SUM(p.win) FROM a_participants p JOIN a_matches m ON m.match_id = p.match_id, json_each(p.late_items) j
         WHERE {} AND p.champion_id = ?5 AND p.position = ?6 AND p.late_items IS NOT NULL
         GROUP BY j.value ORDER BY COUNT(*) DESC LIMIT 8",
        Filter::WHERE
    ))?;
    let late_items = late_stmt
        .query_map(params![f.queue_id, f.patch, f.platform, f.tier, champion, position], |r| {
            Ok(VariantDto { ids: vec![r.get::<_, i64>(0)? as u32], games: r.get(1)?, wins: r.get(2)? })
        })?
        .collect::<Result<_, _>>()?;

    Ok(ChampionBuildDto {
        rune_pages: variants(conn, f, champion, &position, "rune_page", 4)?,
        spells: variants(conn, f, champion, &position, "spells", 4)?,
        start_items: variants(conn, f, champion, &position, "start_items", 4)?,
        core_items: variants(conn, f, champion, &position, "core_items", 5)?,
        boots: variants(conn, f, champion, &position, "boots", 4)?,
        skill_priority: variants(conn, f, champion, &position, "skill_priority", 3)?,
        skill_start: variants(conn, f, champion, &position, "skill_start", 3)?,
        late_items,
        scope,
        champion_id: champion,
        position,
        games,
        wins,
        positions,
        timeline_games: tl,
    })
}

// ---------- Matchups ----------

pub fn matchups(conn: &Connection, f: &Filter, champion: i32, position: Option<&str>) -> BResult<MatchupsDto> {
    let build_pos = match position {
        Some(p) => p.to_string(),
        None => champion_build(conn, f, champion, None)?.position,
    };
    let scope = f.scope(conn)?;
    let (games, wins): (u32, u32) = conn.query_row(
        &format!(
            "SELECT COUNT(*), COALESCE(SUM(p.win), 0) FROM a_participants p JOIN a_matches m ON m.match_id = p.match_id
             WHERE {} AND p.champion_id = ?5 AND p.position = ?6",
            Filter::WHERE
        ),
        params![f.queue_id, f.patch, f.platform, f.tier, champion, build_pos],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let average = if games > 0 { wins as f64 / games as f64 } else { 0.5 };
    let mut stmt = conn.prepare(&format!(
        "SELECT p.opponent_id, COUNT(*), SUM(p.win) FROM a_participants p JOIN a_matches m ON m.match_id = p.match_id
         WHERE {} AND p.champion_id = ?5 AND p.position = ?6 AND p.opponent_id IS NOT NULL
         GROUP BY p.opponent_id",
        Filter::WHERE
    ))?;
    let mut list: Vec<MatchupDto> = stmt
        .query_map(params![f.queue_id, f.patch, f.platform, f.tier, champion, build_pos], |r| {
            let (id, g, w): (i32, u32, u32) = (r.get(0)?, r.get(1)?, r.get(2)?);
            let wr = w as f64 / g as f64;
            Ok(MatchupDto { opponent_id: id, games: g, wins: w, win_rate: wr, delta_pp: (wr - average) * 100.0 })
        })?
        .collect::<Result<_, _>>()?;
    list.sort_by(|a, b| b.games.cmp(&a.games));
    Ok(MatchupsDto { scope, champion_id: champion, position: build_pos, games, wins, average_win_rate: average, matchups: list })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalize;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        c
    }

    fn full_match(id: &str, version: &str, blue_wins: bool) -> MatchDto {
        let mut m = normalize::match_dto(include_str!("../tests/fixtures/match.json")).unwrap();
        m.id = id.into();
        m.game_version = version.into();
        let base = m.participants[0].clone();
        m.participants = (0..10)
            .map(|i| {
                let mut p = base.clone();
                p.participant_id = i as u8 + 1;
                p.team_id = if i < 5 { 100 } else { 200 };
                p.position = Some(POSITIONS[i % 5].into());
                p.champion_id = 100 + i as i32; // 100..104 bleus, 105..109 rouges
                p.win = (i < 5) == blue_wins;
                p
            })
            .collect();
        m
    }

    fn items() -> ItemClasses {
        let mut c = ItemClasses::default();
        c.completed.extend([3089, 3157, 3135, 4645]);
        c.boots.insert(3020);
        c
    }

    #[test]
    fn patch_parsing() {
        assert_eq!(patch_of("16.20.715.1234").as_deref(), Some("16.20"));
        assert_eq!(patch_of("garbage"), None);
    }

    #[test]
    fn skill_priority_order() {
        // A max d'abord, puis E, Z en dernier ; R ignore pour la priorite.
        let order = [1, 2, 3, 1, 1, 4, 1, 3, 1, 4, 3, 3, 3, 2, 2];
        assert_eq!(skill_priority(&order), Some(vec![1, 3, 2]));
        assert_eq!(skill_priority(&[1, 2, 3]), None);
    }

    #[test]
    fn purchases_apply_undo() {
        let t = normalize::timeline_dto(include_str!("../tests/fixtures/timeline.json")).unwrap();
        assert!(purchases(&t, 1).is_empty()); // achat 1055 annule
    }

    #[test]
    fn ingest_and_aggregate() {
        let c = conn();
        let it = items();
        for i in 0..30 {
            let m = full_match(&format!("EUW1_{}", 1_000_000 + i), "16.20.1.1", i % 3 != 0);
            assert!(ingest(&c, &m, None, "MASTER", &it).unwrap());
        }
        // Idempotence
        assert!(!ingest(&c, &full_match("EUW1_1000000", "16.20.1.1", true), None, "MASTER", &it).unwrap());
        // Patch plus ancien : n'entre pas dans le perimetre par defaut.
        ingest(&c, &full_match("EUW1_2000000", "16.19.1.1", true), None, "MASTER", &it).unwrap();

        let f = Filter::resolve(&c, None, None, None, None).unwrap();
        assert_eq!(f.patch, "16.20");
        let tl = tier_list(&c, &f, None).unwrap();
        assert_eq!(tl.scope.matches, 30);
        let top = tl.champions.iter().find(|x| x.champion_id == 100).unwrap();
        assert_eq!((top.games, top.wins), (30, 20));
        assert!((top.pick_rate - 1.0).abs() < 1e-9);
        assert_eq!(top.ban_rate, 0.0); // la fixture ne bannit que 238
        let zed_bans: u32 = c.query_row("SELECT COUNT(*) FROM a_bans WHERE champion_id = 238", [], |r| r.get(0)).unwrap();
        assert_eq!(zed_bans, 31);
        let mu = matchups(&c, &f, 100, Some("TOP")).unwrap();
        assert_eq!(mu.matchups.len(), 1);
        assert_eq!(mu.matchups[0].opponent_id, 105);
        assert!((mu.matchups[0].delta_pp).abs() < 1e-9); // un seul adversaire = moyenne
        let b = champion_build(&c, &f, 100, None).unwrap();
        assert_eq!(b.position, "TOP");
        assert_eq!(b.rune_pages[0].ids, vec![8100, 8112, 8139, 8138, 8135, 8200, 8226, 8210, 5008, 5008, 5011]);
        assert_eq!(b.spells[0].ids, vec![4, 14]);
        assert_eq!(b.timeline_games, 0);
        assert!(b.core_items.is_empty());
    }

    #[test]
    fn baselines_median_and_missing_data() {
        let c = conn();
        let it = items();
        // Trois parties ou les CS montent de 100 en 100 : la mediane tombe sur celle du milieu.
        for (i, cs) in [100u32, 200, 300].iter().enumerate() {
            let mut m = full_match(&format!("EUW1_{}", 3_000_000 + i), "16.20.1.1", true);
            m.duration_sec = 600; // 10 minutes
            for p in &mut m.participants {
                p.cs = *cs;
                p.cc_time_sec = None; // donnee absente partout
            }
            assert!(ingest(&c, &m, None, "MASTER", &it).unwrap());
        }
        let f = Filter::resolve(&c, None, None, None, None).unwrap();
        let b = baselines(&c, &f, None).unwrap();
        assert_eq!(b.sample, 30, "dix joueurs par partie");

        let cs = b.stats.iter().find(|s| s.key == "csPerMin").unwrap();
        assert_eq!(cs.median, Some(20.0), "200 CS en 10 minutes");
        assert_eq!(cs.games, 30);

        // Une mesure que personne ne renseigne reste vide, sans chiffre invente.
        let cc = b.stats.iter().find(|s| s.key == "ccTime").unwrap();
        assert_eq!(cc.median, None);
        assert_eq!(cc.games, 0);

        // Le filtre de poste restreint bien l'echantillon.
        let top = baselines(&c, &f, Some("TOP")).unwrap();
        assert_eq!(top.sample, 6);
    }

    #[test]
    fn tiers_and_shrinkage() {
        assert_eq!(tier_of(0.6, 5), "?");
        assert_eq!(tier_of(0.54, 100), "S+");
        assert_eq!(tier_of(0.48, 100), "C");
        // 3/3 victoires reste proche de 50 % apres retrait
        assert!(adjusted_win_rate(3, 3) < 0.54);
    }

    #[test]
    fn filter_validation() {
        let c = conn();
        assert!(Filter::resolve(&c, Some("x"), None, None, None).is_err());
        assert!(Filter::resolve(&c, None, Some("XX9"), None, None).is_err());
        assert!(Filter::resolve(&c, None, None, Some(450), None).is_err());
        assert!(Filter::resolve(&c, None, None, None, Some("IRON")).is_err());
        assert_eq!(Filter::resolve(&c, None, None, None, None).unwrap().patch, "all");
    }
}
