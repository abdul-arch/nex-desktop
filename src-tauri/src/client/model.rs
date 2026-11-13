//! Modeles normalises du client local et de la partie en direct (fonctions pures, testees).

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSummoner {
    pub game_name: String,
    pub tag_line: String,
    pub platform: Option<String>,
    pub level: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientState {
    /// absent | connected
    pub status: &'static str,
    /// absent | home | lobby | matchmaking | champ_select | loading | in_game | post_game | reconnect
    pub stage: &'static str,
    /// Phase brute du client (pour diagnostic).
    pub phase: String,
    pub summoner: Option<LocalSummoner>,
    pub error: Option<String>,
    pub since: i64,
}

pub fn stage_of(phase: &str) -> &'static str {
    match phase {
        "None" | "TerminatedInError" | "" => "home",
        "Lobby" => "lobby",
        "Matchmaking" | "ReadyCheck" | "CheckedIntoTournament" => "matchmaking",
        "ChampSelect" => "champ_select",
        "GameStart" => "loading",
        "InProgress" => "in_game",
        "WaitingForStats" | "PreEndOfGame" | "EndOfGame" => "post_game",
        "Reconnect" => "reconnect",
        _ => "home",
    }
}

/// Region du client ("EUW") -> plateforme ("EUW1").
pub fn platform_of_region(region: &str) -> Option<&'static str> {
    Some(match region.to_ascii_uppercase().as_str() {
        "EUW" => "EUW1",
        "EUNE" => "EUN1",
        "TR" => "TR1",
        "RU" => "RU",
        "ME" => "ME1",
        "NA" => "NA1",
        "BR" => "BR1",
        "LAN" => "LA1",
        "LAS" => "LA2",
        "KR" => "KR",
        "JP" => "JP1",
        "OCE" => "OC1",
        "SG" => "SG2",
        "TW" => "TW2",
        "VN" => "VN2",
        _ => return None,
    })
}

// ---------- Selection des champions ----------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftSlot {
    pub cell_id: i64,
    /// Champion verrouille ou survole (intention) ; 0 = aucun.
    pub champion_id: i32,
    pub intent: bool,
    /// TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY ; None si inconnu (parties sans postes).
    pub position: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChampSelectState {
    pub local_cell: i64,
    pub my_team: Vec<DraftSlot>,
    pub their_team: Vec<DraftSlot>,
    pub my_bans: Vec<i32>,
    pub their_bans: Vec<i32>,
}

fn position(raw: &str) -> Option<String> {
    Some(
        match raw.to_ascii_lowercase().as_str() {
            "top" => "TOP",
            "jungle" => "JUNGLE",
            "middle" | "mid" => "MIDDLE",
            "bottom" | "bot" => "BOTTOM",
            "utility" | "support" => "UTILITY",
            _ => return None,
        }
        .to_string(),
    )
}

fn slots(v: &Value) -> Vec<DraftSlot> {
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|s| {
                    let locked = s.get("championId").and_then(Value::as_i64).unwrap_or(0);
                    let intent = s.get("championPickIntent").and_then(Value::as_i64).unwrap_or(0);
                    DraftSlot {
                        cell_id: s.get("cellId").and_then(Value::as_i64).unwrap_or(-1),
                        champion_id: if locked > 0 { locked as i32 } else { intent.max(0) as i32 },
                        intent: locked <= 0 && intent > 0,
                        position: s.get("assignedPosition").and_then(Value::as_str).and_then(position),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn ids(v: Option<&Value>) -> Vec<i32> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_i64).filter(|x| *x > 0).map(|x| x as i32).collect())
        .unwrap_or_default()
}

pub fn champ_select(session: &Value) -> ChampSelectState {
    let bans = session.get("bans");
    ChampSelectState {
        local_cell: session.get("localPlayerCellId").and_then(Value::as_i64).unwrap_or(-1),
        my_team: slots(session.get("myTeam").unwrap_or(&Value::Null)),
        their_team: slots(session.get("theirTeam").unwrap_or(&Value::Null)),
        my_bans: ids(bans.and_then(|b| b.get("myTeamBans"))),
        their_bans: ids(bans.and_then(|b| b.get("theirTeamBans"))),
    }
}

// ---------- Partie en direct (Live Client Data) ----------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LivePlayer {
    pub riot_id: String,
    /// Cle Data Dragon deduite de rawChampionName (ex. "MonkeyKing").
    pub champion_key: String,
    pub team: String,
    pub position: Option<String>,
    pub level: u32,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    pub cs: u32,
    pub items: Vec<u32>,
    pub is_dead: bool,
    pub respawn_timer: f64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveTimer {
    /// dragon | elder | baron
    pub kind: String,
    /// Temps de jeu (s) de la prochaine apparition.
    pub next_spawn: f64,
    /// "event" (derive d'un evenement de la partie) | "first_spawn" (regle de jeu fixe).
    pub source: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveSnapshot {
    pub game_time: f64,
    pub game_mode: String,
    pub active_level: u32,
    /// Rangs A/Z/E/R (ou Q/W/E/R) du joueur.
    pub abilities: [u32; 4],
    /// Points de competence non depenses (niveau - somme des rangs) ; jamais negatif.
    pub unspent_points: u32,
    pub current_gold: f64,
    pub players: Vec<LivePlayer>,
    pub objectives: Vec<ObjectiveTimer>,
    /// Moments de la partie concernant le joueur (marqueurs et clips automatiques).
    pub highlights: Vec<Highlight>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    /// Temps de jeu (s).
    pub time: f64,
    /// kill | death | multikill | ace | steal | objective
    pub kind: String,
    pub label: String,
    /// Merite un clip automatique (multikill >= 2, ace, vol d'objectif).
    pub clip_worthy: bool,
}

fn s<'a>(e: &'a Value, k: &str) -> &'a str {
    e.get(k).and_then(Value::as_str).unwrap_or("")
}

/// Moments de la partie pour le joueur `me` (nom de jeu du Riot ID, tel qu'utilise par les evenements).
pub fn highlights(events: &[Value], me: &str, my_team: &str) -> Vec<Highlight> {
    if me.is_empty() {
        return vec![];
    }
    let mut out = Vec::new();
    for e in events {
        let t = e.get("EventTime").and_then(Value::as_f64).unwrap_or(0.0);
        let h = |kind: &str, label: String, clip: bool| Highlight { time: t, kind: kind.into(), label, clip_worthy: clip };
        match s(e, "EventName") {
            "ChampionKill" if s(e, "KillerName") == me => out.push(h("kill", format!("Élimination ({})", s(e, "VictimName")), false)),
            "ChampionKill" if s(e, "VictimName") == me => out.push(h("death", "Mort".into(), false)),
            "Multikill" if s(e, "KillerName") == me => {
                let n = e.get("KillStreak").and_then(Value::as_u64).unwrap_or(2);
                let label = match n {
                    2 => "Double kill",
                    3 => "Triple kill",
                    4 => "Quadra kill",
                    _ => "Pentakill",
                };
                out.push(h("multikill", label.into(), true));
            }
            "Ace" if s(e, "AcingTeam") == my_team && !my_team.is_empty() => out.push(h("ace", "Ace".into(), true)),
            name @ ("DragonKill" | "BaronKill" | "HeraldKill") if s(e, "KillerName") == me => {
                let stolen = s(e, "Stolen") == "True";
                let what = match name {
                    "DragonKill" => "dragon",
                    "BaronKill" => "Baron",
                    _ => "Héraut",
                };
                if stolen {
                    out.push(h("steal", format!("Vol de {what}"), true));
                } else {
                    out.push(h("objective", format!("Objectif : {what}"), false));
                }
            }
            _ => {}
        }
    }
    out
}

fn u(v: &Value, k: &str) -> u32 {
    v.get(k).and_then(Value::as_u64).unwrap_or(0) as u32
}

/// "game_character_displayname_MonkeyKing" -> "MonkeyKing"
pub fn champion_key(raw: &str) -> String {
    let k = raw.rsplit('_').next().unwrap_or(raw);
    if !k.is_empty() && k.len() <= 32 && k.bytes().all(|b| b.is_ascii_alphanumeric()) { k.to_string() } else { String::new() }
}

pub const DRAGON_FIRST_SPAWN: f64 = 300.0;
pub const DRAGON_RESPAWN: f64 = 300.0;
pub const ELDER_RESPAWN: f64 = 360.0;
pub const BARON_RESPAWN: f64 = 360.0;

/// Minuteurs uniquement verifiables : premier dragon (5:00) et reapparitions apres un
/// evenement de mort annonce a tous les joueurs (DragonKill, BaronKill).
pub fn objective_timers(events: &[Value], game_time: f64) -> Vec<ObjectiveTimer> {
    let mut last_dragon: Option<(f64, bool)> = None;
    let mut last_baron: Option<f64> = None;
    for e in events {
        let t = e.get("EventTime").and_then(Value::as_f64).unwrap_or(0.0);
        match e.get("EventName").and_then(Value::as_str) {
            Some("DragonKill") => {
                let elder = e.get("DragonType").and_then(Value::as_str) == Some("Elder");
                last_dragon = Some((t, elder));
            }
            Some("BaronKill") => last_baron = Some(t),
            _ => {}
        }
    }
    let mut out = Vec::new();
    match last_dragon {
        None if game_time < DRAGON_FIRST_SPAWN => out.push(ObjectiveTimer { kind: "dragon".into(), next_spawn: DRAGON_FIRST_SPAWN, source: "first_spawn" }),
        Some((t, elder)) => {
            let next = t + if elder { ELDER_RESPAWN } else { DRAGON_RESPAWN };
            if next > game_time {
                out.push(ObjectiveTimer { kind: if elder { "elder".into() } else { "dragon".into() }, next_spawn: next, source: "event" });
            }
        }
        None => {}
    }
    if let Some(t) = last_baron {
        if t + BARON_RESPAWN > game_time {
            out.push(ObjectiveTimer { kind: "baron".into(), next_spawn: t + BARON_RESPAWN, source: "event" });
        }
    }
    out
}

pub fn live_snapshot(all: &Value) -> Option<LiveSnapshot> {
    let game = all.get("gameData")?;
    let game_time = game.get("gameTime").and_then(Value::as_f64)?;
    let active = all.get("activePlayer").unwrap_or(&Value::Null);
    let active_id = active.get("riotId").and_then(Value::as_str).unwrap_or("");
    let ab = active.get("abilities").unwrap_or(&Value::Null);
    let rank = |k: &str| ab.get(k).map(|a| u(a, "abilityLevel")).unwrap_or(0);
    let abilities = [rank("Q"), rank("W"), rank("E"), rank("R")];
    let level = u(active, "level");
    let spent: u32 = abilities.iter().sum();
    let players: Vec<LivePlayer> = all
        .get("allPlayers")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|p| {
                    let scores = p.get("scores").unwrap_or(&Value::Null);
                    let mut items: Vec<(u32, u32)> = p
                        .get("items")
                        .and_then(Value::as_array)
                        .map(|it| it.iter().map(|i| (u(i, "slot"), u(i, "itemID"))).collect())
                        .unwrap_or_default();
                    items.sort_unstable();
                    let riot_id = p.get("riotId").and_then(Value::as_str).unwrap_or("").to_string();
                    LivePlayer {
                        is_active: !active_id.is_empty() && riot_id == active_id,
                        riot_id,
                        champion_key: champion_key(p.get("rawChampionName").and_then(Value::as_str).unwrap_or("")),
                        team: p.get("team").and_then(Value::as_str).unwrap_or("").to_string(),
                        position: p.get("position").and_then(Value::as_str).and_then(position),
                        level: u(p, "level"),
                        kills: u(scores, "kills"),
                        deaths: u(scores, "deaths"),
                        assists: u(scores, "assists"),
                        cs: u(scores, "creepScore"),
                        items: items.into_iter().map(|(_, id)| id).collect(),
                        is_dead: p.get("isDead").and_then(Value::as_bool).unwrap_or(false),
                        respawn_timer: p.get("respawnTimer").and_then(Value::as_f64).unwrap_or(0.0),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let events = all.get("events").and_then(|e| e.get("Events")).and_then(Value::as_array).cloned().unwrap_or_default();
    let me_name = active
        .get("riotIdGameName")
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty())
        .or_else(|| active.get("summonerName").and_then(Value::as_str))
        .or_else(|| active_id.split('#').next())
        .unwrap_or("");
    let my_team = players.iter().find(|p: &&LivePlayer| p.is_active).map(|p| p.team.clone()).unwrap_or_default();
    Some(LiveSnapshot {
        highlights: highlights(&events, me_name, &my_team),
        game_time,
        game_mode: game.get("gameMode").and_then(Value::as_str).unwrap_or("").to_string(),
        active_level: level,
        abilities,
        unspent_points: level.saturating_sub(spent),
        current_gold: active.get("currentGold").and_then(Value::as_f64).unwrap_or(0.0),
        players,
        // Dragons et Baron n'existent que sur la Faille de l'invocateur (carte 11) : pas de
        // minuteur en ARAM / ARAM Mayhem (Abime hurlant, carte 12) ni dans les autres modes.
        objectives: if game.get("mapNumber").and_then(Value::as_u64) == Some(11) { objective_timers(&events, game_time) } else { Vec::new() },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stages() {
        assert_eq!(stage_of("ChampSelect"), "champ_select");
        assert_eq!(stage_of("InProgress"), "in_game");
        assert_eq!(stage_of("EndOfGame"), "post_game");
        assert_eq!(stage_of("Bizarre"), "home");
        assert_eq!(platform_of_region("euw"), Some("EUW1"));
        assert_eq!(platform_of_region("XX"), None);
    }

    #[test]
    fn champ_select_normalization() {
        let s = json!({
            "localPlayerCellId": 2,
            "myTeam": [{"cellId": 2, "championId": 0, "championPickIntent": 103, "assignedPosition": "middle"},
                       {"cellId": 3, "championId": 64, "championPickIntent": 0, "assignedPosition": "jungle"}],
            "theirTeam": [{"cellId": 7, "championId": 238, "assignedPosition": ""}],
            "bans": {"myTeamBans": [157, 0], "theirTeamBans": [-1, 555]}
        });
        let c = champ_select(&s);
        assert_eq!(c.local_cell, 2);
        assert_eq!(c.my_team[0].champion_id, 103);
        assert!(c.my_team[0].intent);
        assert_eq!(c.my_team[0].position.as_deref(), Some("MIDDLE"));
        assert!(!c.my_team[1].intent);
        assert_eq!(c.their_team[0].position, None);
        assert_eq!(c.my_bans, vec![157]);
        assert_eq!(c.their_bans, vec![555]);
    }

    #[test]
    fn timers_from_events() {
        // Avant 5:00 sans dragon : premier dragon.
        assert_eq!(objective_timers(&[], 120.0)[0].next_spawn, 300.0);
        // Dragon tue a 10:00 -> 15:00 ; baron tue a 25:00 -> 31:00.
        let ev = vec![
            json!({"EventName": "DragonKill", "EventTime": 600.0, "DragonType": "Fire"}),
            json!({"EventName": "BaronKill", "EventTime": 1500.0}),
        ];
        let t = objective_timers(&ev, 1520.0);
        assert!(t.iter().all(|x| x.source == "event"));
        assert!(t.iter().any(|x| x.kind == "baron" && x.next_spawn == 1860.0));
        assert!(!t.iter().any(|x| x.kind == "dragon")); // 15:00 deja passe
        let elder = vec![json!({"EventName": "DragonKill", "EventTime": 2000.0, "DragonType": "Elder"})];
        assert_eq!(objective_timers(&elder, 2010.0)[0].next_spawn, 2360.0);
    }

    #[test]
    fn highlights_for_player() {
        let ev = vec![
            json!({"EventName": "ChampionKill", "EventTime": 100.0, "KillerName": "Moi", "VictimName": "Lui"}),
            json!({"EventName": "Multikill", "EventTime": 101.0, "KillerName": "Moi", "KillStreak": 3}),
            json!({"EventName": "ChampionKill", "EventTime": 200.0, "KillerName": "Lui", "VictimName": "Moi"}),
            json!({"EventName": "BaronKill", "EventTime": 1300.0, "KillerName": "Moi", "Stolen": "True"}),
            json!({"EventName": "Ace", "EventTime": 1400.0, "Acer": "X", "AcingTeam": "ORDER"}),
            json!({"EventName": "Ace", "EventTime": 1500.0, "Acer": "Y", "AcingTeam": "CHAOS"}),
            json!({"EventName": "Multikill", "EventTime": 1600.0, "KillerName": "Autre", "KillStreak": 5}),
        ];
        let h = highlights(&ev, "Moi", "ORDER");
        let kinds: Vec<&str> = h.iter().map(|x| x.kind.as_str()).collect();
        assert_eq!(kinds, vec!["kill", "multikill", "death", "steal", "ace"]);
        assert_eq!(h[1].label, "Triple kill");
        assert_eq!(h.iter().filter(|x| x.clip_worthy).count(), 3);
        assert!(highlights(&ev, "", "ORDER").is_empty());
    }

    #[test]
    fn snapshot_normalization() {
        let all = json!({
            "activePlayer": {"riotId": "Moi#EUW", "level": 6, "currentGold": 1234.5,
                "abilities": {"Q": {"abilityLevel": 3}, "W": {"abilityLevel": 1}, "E": {"abilityLevel": 1}, "R": {"abilityLevel": 0}}},
            "allPlayers": [
                {"riotId": "Moi#EUW", "rawChampionName": "game_character_displayname_Ahri", "team": "ORDER", "position": "MIDDLE", "level": 6,
                 "scores": {"kills": 2, "deaths": 1, "assists": 3, "creepScore": 54}, "items": [{"itemID": 3340, "slot": 6}, {"itemID": 1056, "slot": 0}], "isDead": false, "respawnTimer": 0.0},
                {"riotId": "Lui#EUW", "rawChampionName": "game_character_displayname_../x", "team": "CHAOS", "position": "", "level": 5, "scores": {}, "items": []}
            ],
            "events": {"Events": [{"EventName": "GameStart", "EventTime": 0.0}]},
            "gameData": {"gameTime": 431.2, "gameMode": "CLASSIC"}
        });
        let s = live_snapshot(&all).unwrap();
        assert_eq!(s.unspent_points, 1);
        assert_eq!(s.players[0].items, vec![1056, 3340]);
        assert!(s.players[0].is_active);
        assert_eq!(s.players[0].champion_key, "Ahri");
        assert_eq!(s.players[1].champion_key, "");
        assert_eq!(s.players[1].position, None);
        assert!(live_snapshot(&json!({})).is_none());
    }

    #[test]
    fn objective_timers_only_on_summoners_rift() {
        // Constat en partie ARAM Mayhem reelle : l'overlay affichait « Dragon 0:10 ».
        let game = |map: u64| json!({"allPlayers": [], "events": {"Events": []}, "gameData": {"gameTime": 100.0, "gameMode": "KIWI", "mapNumber": map}});
        assert!(live_snapshot(&game(12)).unwrap().objectives.is_empty(), "Abime hurlant : aucun dragon");
        assert_eq!(live_snapshot(&game(11)).unwrap().objectives[0].kind, "dragon");
    }
}
