//! Conversion des reponses Riot (match-v5, timeline, league-v4...) vers les contrats NEX.
//! Lecture tolerante : un champ absent prend une valeur neutre, jamais une valeur inventee.

use crate::error::{BResult, BackendError};
use nex_domain::api::*;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

/// Version de normalisation, incluse dans les cles de cache. Incrementer quand un champ
/// est ajoute : les parties deja en cache sont immuables et ne seraient jamais relues.
/// v2 : premier sang, controle de foule, degats aux objectifs et aux tours, plus longue
/// serie, balises de controle posees.
/// v3 : temps passe mort, plaques de tourelle.
/// v4 : icone d'invocateur de chaque participant.
pub const NORMALIZE_VERSION: u32 = 4;

// ---------- account-v1 / summoner-v4 / league-v4 ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RAccount {
    pub puuid: String,
    #[serde(default)]
    pub game_name: String,
    #[serde(default)]
    pub tag_line: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RSummoner {
    #[serde(default)]
    pub profile_icon_id: u32,
    #[serde(default)]
    pub summoner_level: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RLeagueEntry {
    queue_type: String,
    #[serde(default)]
    tier: String,
    #[serde(default)]
    rank: Option<String>,
    #[serde(default)]
    league_points: i32,
    #[serde(default)]
    wins: u32,
    #[serde(default)]
    losses: u32,
}

pub fn league_entries(body: &str) -> BResult<Vec<RankDto>> {
    let entries: Vec<RLeagueEntry> = serde_json::from_str(body)?;
    Ok(entries
        .into_iter()
        .map(|e| {
            // Maitre et au-dela : pas de division significative.
            let apex = matches!(e.tier.as_str(), "MASTER" | "GRANDMASTER" | "CHALLENGER");
            RankDto {
                queue: e.queue_type,
                tier: e.tier,
                division: if apex { None } else { e.rank },
                lp: e.league_points,
                wins: e.wins,
                losses: e.losses,
            }
        })
        .collect())
}

// ---------- match-v5 ----------

#[derive(Deserialize)]
struct RMatch {
    metadata: RMeta,
    info: RInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RMeta {
    match_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RInfo {
    #[serde(default)]
    game_start_timestamp: i64,
    #[serde(default)]
    game_creation: i64,
    #[serde(default)]
    game_end_timestamp: Option<i64>,
    #[serde(default)]
    game_duration: i64,
    #[serde(default)]
    queue_id: u32,
    #[serde(default)]
    game_mode: String,
    #[serde(default)]
    game_version: String,
    #[serde(default)]
    platform_id: String,
    #[serde(default)]
    participants: Vec<RParticipant>,
    #[serde(default)]
    teams: Vec<RTeam>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RParticipant {
    participant_id: u8,
    puuid: String,
    #[serde(alias = "riotIdName")]
    riot_id_game_name: String,
    #[serde(alias = "riotIdTagLine")]
    riot_id_tagline: String,
    champion_name: String,
    champion_id: i32,
    champ_level: u32,
    team_id: u16,
    team_position: String,
    win: bool,
    kills: u32,
    deaths: u32,
    assists: u32,
    total_minions_killed: u32,
    neutral_minions_killed: u32,
    gold_earned: u32,
    total_damage_dealt_to_champions: u32,
    total_damage_taken: u32,
    vision_score: u32,
    wards_placed: u32,
    wards_killed: u32,
    vision_wards_bought_in_game: u32,
    item0: u32,
    item1: u32,
    item2: u32,
    item3: u32,
    item4: u32,
    item5: u32,
    item6: u32,
    summoner1_id: u32,
    summoner2_id: u32,
    perks: RPerks,
    game_ended_in_early_surrender: bool,
    largest_multi_kill: u32,
    first_blood_kill: bool,
    #[serde(rename = "timeCCingOthers")]
    time_ccing_others: u32,
    damage_dealt_to_objectives: u32,
    damage_dealt_to_turrets: u32,
    largest_killing_spree: u32,
    detector_wards_placed: u32,
    total_time_spent_dead: u32,
    profile_icon: u32,
    challenges: Option<Value>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RPerks {
    stat_perks: HashMap<String, u32>,
    styles: Vec<RStyle>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RStyle {
    description: String,
    style: u32,
    selections: Vec<RSelection>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RSelection {
    perk: u32,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RTeam {
    team_id: u16,
    win: bool,
    bans: Vec<RBan>,
    objectives: HashMap<String, RObjective>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RBan {
    champion_id: i32,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RObjective {
    kills: u32,
}

pub fn match_dto(body: &str) -> BResult<MatchDto> {
    let m: RMatch = serde_json::from_str(body)?;
    let info = m.info;
    // gameDuration est en secondes si gameEndTimestamp existe (depuis 11.20), sinon en ms.
    let duration_sec = if info.game_end_timestamp.is_some() {
        info.game_duration
    } else {
        info.game_duration / 1000
    };
    if duration_sec < 0 {
        return Err(BackendError::Upstream("duree de partie invalide".into()));
    }
    let remake = info.participants.iter().any(|p| p.game_ended_in_early_surrender);
    let platform = if info.platform_id.is_empty() {
        m.metadata.match_id.split('_').next().unwrap_or_default().to_string()
    } else {
        info.platform_id.clone()
    };

    let participants = info
        .participants
        .into_iter()
        .map(|p| {
            let primary = p.perks.styles.iter().find(|s| s.description == "primaryStyle");
            let secondary = p.perks.styles.iter().find(|s| s.description == "subStyle");
            let perks = primary
                .iter()
                .chain(secondary.iter())
                .flat_map(|s| s.selections.iter().map(|x| x.perk))
                .collect();
            let stat_perks = ["offense", "flex", "defense"]
                .iter()
                .filter_map(|k| p.perks.stat_perks.get(*k).copied())
                .collect();
            let challenge = |k: &str| p.challenges.as_ref().and_then(|c| c.get(k)).and_then(Value::as_u64).map(|v| v as u32);
            let solo_kills = challenge("soloKills");
            let turret_plates = challenge("turretPlatesTaken");
            ParticipantDto {
                participant_id: p.participant_id,
                puuid: p.puuid,
                game_name: p.riot_id_game_name,
                tag_line: p.riot_id_tagline,
                champion: p.champion_name,
                champion_id: p.champion_id,
                champion_level: p.champ_level,
                team_id: p.team_id,
                position: Some(p.team_position).filter(|s| !s.is_empty() && s != "Invalid"),
                win: p.win,
                kills: p.kills,
                deaths: p.deaths,
                assists: p.assists,
                cs: p.total_minions_killed + p.neutral_minions_killed,
                gold_earned: p.gold_earned,
                damage_to_champions: p.total_damage_dealt_to_champions,
                damage_taken: p.total_damage_taken,
                vision_score: p.vision_score,
                wards_placed: p.wards_placed,
                wards_killed: p.wards_killed,
                control_wards_bought: p.vision_wards_bought_in_game,
                items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
                spells: [p.summoner1_id, p.summoner2_id],
                keystone: primary.and_then(|s| s.selections.first()).map(|s| s.perk),
                primary_style: primary.map(|s| s.style),
                secondary_style: secondary.map(|s| s.style),
                perks,
                stat_perks,
                solo_kills,
                largest_multi_kill: p.largest_multi_kill,
                first_blood: Some(p.first_blood_kill),
                cc_time_sec: Some(p.time_ccing_others),
                damage_to_objectives: Some(p.damage_dealt_to_objectives),
                damage_to_turrets: Some(p.damage_dealt_to_turrets),
                largest_killing_spree: Some(p.largest_killing_spree),
                detector_wards_placed: Some(p.detector_wards_placed),
                time_dead_sec: Some(p.total_time_spent_dead),
                turret_plates,
                profile_icon_id: Some(p.profile_icon),
            }
        })
        .collect();

    let obj = |t: &RTeam, k: &str| t.objectives.get(k).map(|o| o.kills).unwrap_or(0);
    let teams = info
        .teams
        .iter()
        .map(|t| TeamDto {
            team_id: t.team_id,
            win: t.win,
            bans: t.bans.iter().map(|b| b.champion_id).collect(),
            objectives: ObjectivesDto {
                champion: obj(t, "champion"),
                baron: obj(t, "baron"),
                dragon: obj(t, "dragon"),
                herald: obj(t, "riftHerald"),
                horde: obj(t, "horde"),
                tower: obj(t, "tower"),
                inhibitor: obj(t, "inhibitor"),
            },
        })
        .collect();

    Ok(MatchDto {
        id: m.metadata.match_id,
        platform,
        queue_id: info.queue_id,
        queue: if info.game_mode == "CHERRY" { "arena".to_string() } else { queue_category(info.queue_id).to_string() },
        game_mode: info.game_mode,
        game_version: info.game_version,
        started_at: if info.game_start_timestamp > 0 { info.game_start_timestamp } else { info.game_creation },
        duration_sec: duration_sec as u32,
        remake,
        participants,
        teams,
        gold_at_15: None,
    })
}

// ---------- timeline ----------

#[derive(Deserialize)]
struct RTimeline {
    metadata: RMeta,
    info: RTimelineInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RTimelineInfo {
    #[serde(default)]
    frame_interval: u64,
    #[serde(default)]
    frames: Vec<RFrame>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RFrame {
    timestamp: u64,
    #[serde(default)]
    participant_frames: HashMap<String, RPFrame>,
    #[serde(default)]
    events: Vec<Value>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RPFrame {
    participant_id: u8,
    total_gold: u32,
    minions_killed: u32,
    jungle_minions_killed: u32,
    xp: u32,
    level: u32,
}

fn u(v: &Value, k: &str) -> Option<u64> {
    v.get(k).and_then(Value::as_u64)
}

fn event(v: &Value) -> Option<TimelineEventDto> {
    let kind = match v.get("type")?.as_str()? {
        "ITEM_PURCHASED" => "item_purchased",
        "ITEM_SOLD" => "item_sold",
        "ITEM_UNDO" => "item_undo",
        "ITEM_DESTROYED" => "item_destroyed",
        "SKILL_LEVEL_UP" => "skill_level_up",
        "CHAMPION_KILL" => "champion_kill",
        "ELITE_MONSTER_KILL" => "elite_monster_kill",
        "BUILDING_KILL" => "building_kill",
        _ => return None,
    };
    let mut e = TimelineEventDto {
        timestamp: u(v, "timestamp").unwrap_or(0),
        kind: kind.to_string(),
        participant_id: None,
        item_id: None,
        before_item_id: None,
        skill_slot: None,
        victim_id: None,
        assisting_ids: vec![],
        team_id: None,
        monster_type: None,
    };
    let pid = |k: &str| u(v, k).map(|x| x as u8);
    match kind {
        "item_purchased" | "item_sold" | "item_destroyed" => {
            e.participant_id = pid("participantId");
            e.item_id = u(v, "itemId").map(|x| x as u32);
        }
        "item_undo" => {
            e.participant_id = pid("participantId");
            e.before_item_id = u(v, "beforeId").map(|x| x as u32);
            e.item_id = u(v, "afterId").map(|x| x as u32);
        }
        "skill_level_up" => {
            // Les evolutions (EVOLVE) ne sont pas des points de competence.
            if v.get("levelUpType").and_then(Value::as_str) == Some("EVOLVE") {
                return None;
            }
            e.participant_id = pid("participantId");
            e.skill_slot = u(v, "skillSlot").map(|x| x as u8);
        }
        "champion_kill" => {
            e.participant_id = pid("killerId");
            e.victim_id = pid("victimId");
            e.assisting_ids = v
                .get("assistingParticipantIds")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_u64).map(|x| x as u8).collect())
                .unwrap_or_default();
        }
        "elite_monster_kill" => {
            e.participant_id = pid("killerId");
            e.team_id = u(v, "killerTeamId").map(|x| x as u16);
            e.monster_type = v.get("monsterType").and_then(Value::as_str).map(str::to_string);
        }
        "building_kill" => {
            e.participant_id = pid("killerId");
            // teamId = equipe qui PERD le batiment.
            e.team_id = u(v, "teamId").map(|x| x as u16);
            e.monster_type = v.get("buildingType").and_then(Value::as_str).map(str::to_string);
        }
        _ => {}
    }
    Some(e)
}

pub fn timeline_dto(body: &str) -> BResult<TimelineDto> {
    let t: RTimeline = serde_json::from_str(body)?;
    let frames = t
        .info
        .frames
        .iter()
        .map(|f| {
            let mut players: Vec<FramePlayerDto> = f
                .participant_frames
                .values()
                .map(|p| FramePlayerDto {
                    participant_id: p.participant_id,
                    total_gold: p.total_gold,
                    cs: p.minions_killed + p.jungle_minions_killed,
                    xp: p.xp,
                    level: p.level,
                })
                .collect();
            players.sort_by_key(|p| p.participant_id);
            FrameDto { timestamp: f.timestamp, players }
        })
        .collect();
    let events = t.info.frames.iter().flat_map(|f| f.events.iter().filter_map(event)).collect();
    Ok(TimelineDto {
        match_id: t.metadata.match_id,
        frame_interval_ms: if t.info.frame_interval > 0 { t.info.frame_interval } else { 60_000 },
        frames,
        events,
    })
}

/// Or total de chaque participant a 15:00 (frame la plus proche, tolerance 30 s).
/// None si la partie n'atteint pas 15 minutes.
pub fn gold_at_15(m: &MatchDto, t: &TimelineDto) -> Option<Vec<u32>> {
    const AT: u64 = 15 * 60 * 1000;
    let frame = t.frames.iter().min_by_key(|f| f.timestamp.abs_diff(AT))?;
    if frame.timestamp.abs_diff(AT) > 30_000 {
        return None;
    }
    m.participants
        .iter()
        .map(|p| frame.players.iter().find(|f| f.participant_id == p.participant_id).map(|f| f.total_gold))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MATCH: &str = include_str!("../tests/fixtures/match.json");
    const TIMELINE: &str = include_str!("../tests/fixtures/timeline.json");

    #[test]
    fn normalizes_match() {
        let m = match_dto(MATCH).unwrap();
        assert_eq!(m.id, "EUW1_7000000001");
        assert_eq!(m.queue, "solo");
        assert_eq!(m.duration_sec, 1800);
        assert!(!m.remake);
        assert_eq!(m.participants.len(), 2);
        let p = &m.participants[0];
        assert_eq!(p.cs, 200 + 10);
        assert_eq!(p.items, [3089, 3020, 0, 0, 0, 0, 3340]);
        assert_eq!(p.keystone, Some(8112));
        assert_eq!(p.perks, vec![8112, 8139, 8138, 8135, 8226, 8210]);
        assert_eq!(p.stat_perks, vec![5008, 5008, 5011]);
        assert_eq!(p.solo_kills, Some(2));
        assert_eq!(p.position.as_deref(), Some("MIDDLE"));
        assert_eq!(m.participants[1].solo_kills, None);
        assert_eq!(m.participants[1].position, None);
        assert_eq!(m.teams[0].objectives.dragon, 3);
        assert_eq!(m.teams[0].bans, vec![238, -1]);
    }

    #[test]
    fn legacy_duration_in_ms_and_remake() {
        let legacy = MATCH
            .replace("\"gameEndTimestamp\": 1762500000000,", "")
            .replace("\"gameDuration\": 1800", "\"gameDuration\": 1800000")
            .replace("\"gameEndedInEarlySurrender\": false", "\"gameEndedInEarlySurrender\": true");
        let m = match_dto(&legacy).unwrap();
        assert_eq!(m.duration_sec, 1800);
        assert!(m.remake);
    }

    #[test]
    fn normalizes_timeline_and_gold_at_15() {
        let m = match_dto(MATCH).unwrap();
        let t = timeline_dto(TIMELINE).unwrap();
        assert_eq!(t.frames.len(), 3);
        assert_eq!(t.frames[1].players[0].cs, 3 + 1);
        let kinds: Vec<&str> = t.events.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, vec!["item_purchased", "item_undo", "skill_level_up", "champion_kill", "elite_monster_kill"]);
        let undo = &t.events[1];
        assert_eq!((undo.before_item_id, undo.item_id), (Some(1055), Some(0)));
        assert_eq!(t.events[3].assisting_ids, vec![2]);
        assert_eq!(gold_at_15(&m, &t), Some(vec![6200, 5400]));
    }

    #[test]
    fn league_apex_has_no_division() {
        let r = league_entries(r#"[{"queueType":"RANKED_SOLO_5x5","tier":"MASTER","rank":"I","leaguePoints":120,"wins":10,"losses":5}]"#).unwrap();
        assert_eq!(r[0].division, None);
        assert_eq!(r[0].lp, 120);
    }

    #[test]
    fn rejects_garbage() {
        assert!(match_dto("{}").is_err());
        assert!(timeline_dto("[]").is_err());
    }
}
