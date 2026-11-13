//! Historique local du client League, pour les parties que l'API publique de Riot ne fournit
//! pas : ARAM Mayhem (file 2400). Verifie le 9 novembre 2026 : match-v5 ne liste pas ces
//! parties et repond 403 quand on les demande par identifiant, alors que le client les a.
//! Lecture seule, compte connecte au client uniquement.

use crate::adapters::lcu::{Lcu, paths};
use crate::error::AppResult;
use crate::persistence::{Db, cache};
use nex_domain::api::{MatchDto, ObjectivesDto, ParticipantDto, TeamDto, queue_category};
use nex_domain::riot::RiotId;
use serde_json::Value;
use std::collections::HashMap;

/// File ARAM Mayhem (mode de jeu `KIWI`).
pub const MAYHEM_QUEUE: u64 = 2400;
/// Nombre de parties recentes du client parcourues pour y trouver les parties Mayhem.
const WINDOW: u32 = 60;
/// Une partie terminee ne change plus : longue conservation.
const GAME_TTL_SECS: i64 = 30 * 24 * 3600;

fn num(v: &Value, k: &str) -> u32 {
    v.get(k).and_then(Value::as_u64).map(|x| x.min(u32::MAX as u64) as u32).unwrap_or(0)
}
fn text(v: &Value, k: &str, max: usize) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").chars().filter(|c| !c.is_control()).take(max).collect()
}
fn positive(n: u32) -> Option<u32> {
    (n > 0).then_some(n)
}
/// `None` quand la cle manque : distingue « non fourni » de « zero ».
fn opt_num(v: &Value, k: &str) -> Option<u32> {
    v.get(k).and_then(Value::as_u64).map(|x| x.min(u32::MAX as u64) as u32)
}

/// Convertit une partie du client (ancien format « v4 » : `participants` + `participantIdentities`)
/// en `MatchDto`. `champion_key` donne la cle Data Dragon d'un champion (ex. 62 -> "MonkeyKing").
/// Renvoie `None` si la partie est illisible. Les postes ne sont pas renseignes : les champs
/// `lane` / `role` de ce format ne sont pas fiables.
pub fn match_from_client(g: &Value, champion_key: &dyn Fn(i32) -> Option<String>) -> Option<MatchDto> {
    let game_id = g.get("gameId")?.as_u64()?;
    let platform = g.get("platformId")?.as_str().filter(|p| (2..=8).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric()))?.to_string();
    let players: HashMap<u64, &Value> = g
        .get("participantIdentities")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|i| Some((i.get("participantId")?.as_u64()?, i.get("player")?))).collect())
        .unwrap_or_default();

    let participants: Vec<ParticipantDto> = g
        .get("participants")?
        .as_array()?
        .iter()
        .take(16)
        .filter_map(|p| {
            let pid = p.get("participantId")?.as_u64()?;
            let st = p.get("stats")?;
            let player = players.get(&pid);
            let champion_id = p.get("championId").and_then(Value::as_i64).unwrap_or(0) as i32;
            let name = player.map(|pl| text(pl, "gameName", 32)).filter(|n| !n.is_empty()).or_else(|| player.map(|pl| text(pl, "summonerName", 32)));
            Some(ParticipantDto {
                participant_id: pid.min(255) as u8,
                puuid: player.map(|pl| text(pl, "puuid", 100)).unwrap_or_default(),
                game_name: name.unwrap_or_default(),
                tag_line: player.map(|pl| text(pl, "tagLine", 8)).unwrap_or_default(),
                champion: champion_key(champion_id).unwrap_or_default(),
                champion_id,
                champion_level: num(st, "champLevel"),
                team_id: num(p, "teamId").min(u16::MAX as u32) as u16,
                position: None,
                win: st.get("win").and_then(Value::as_bool).unwrap_or(false),
                kills: num(st, "kills"),
                deaths: num(st, "deaths"),
                assists: num(st, "assists"),
                cs: num(st, "totalMinionsKilled") + num(st, "neutralMinionsKilled"),
                gold_earned: num(st, "goldEarned"),
                damage_to_champions: num(st, "totalDamageDealtToChampions"),
                damage_taken: num(st, "totalDamageTaken"),
                vision_score: num(st, "visionScore"),
                wards_placed: num(st, "wardsPlaced"),
                wards_killed: num(st, "wardsKilled"),
                control_wards_bought: num(st, "visionWardsBoughtInGame"),
                items: ["item0", "item1", "item2", "item3", "item4", "item5", "item6"].map(|k| num(st, k)),
                spells: [num(p, "spell1Id"), num(p, "spell2Id")],
                keystone: positive(num(st, "perk0")),
                primary_style: positive(num(st, "perkPrimaryStyle")),
                secondary_style: positive(num(st, "perkSubStyle")),
                perks: ["perk0", "perk1", "perk2", "perk3", "perk4", "perk5"].iter().map(|k| num(st, k)).filter(|x| *x > 0).collect(),
                stat_perks: Vec::new(),
                solo_kills: None,
                largest_multi_kill: num(st, "largestMultiKill"),
                // Le format « v4 » du client porte ces statistiques ; absentes, elles
                // restent `None` et aucun badge ne s'appuie dessus.
                first_blood: st.get("firstBloodKill").and_then(Value::as_bool),
                cc_time_sec: opt_num(st, "timeCCingOthers"),
                damage_to_objectives: opt_num(st, "damageDealtToObjectives"),
                damage_to_turrets: opt_num(st, "damageDealtToTurrets"),
                largest_killing_spree: opt_num(st, "largestKillingSpree"),
                detector_wards_placed: None,
                time_dead_sec: opt_num(st, "totalTimeSpentDead"),
                // Les plaques ne figurent pas dans le format « v4 » du client.
                turret_plates: None,
            })
        })
        .collect();
    if participants.is_empty() {
        return None;
    }

    let teams = g
        .get("teams")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .take(4)
                .map(|t| {
                    let team_id = num(t, "teamId").min(u16::MAX as u32) as u16;
                    // « Win » / « Fail » dans ce format ; un booleen est accepte aussi.
                    let win = match t.get("win") {
                        Some(Value::String(s)) => s == "Win",
                        Some(Value::Bool(b)) => *b,
                        _ => participants.iter().any(|p| p.team_id == team_id && p.win),
                    };
                    TeamDto {
                        team_id,
                        win,
                        bans: t.get("bans").and_then(Value::as_array).map(|b| b.iter().filter_map(|x| x.get("championId").and_then(Value::as_i64)).map(|x| x as i32).collect()).unwrap_or_default(),
                        objectives: ObjectivesDto {
                            champion: participants.iter().filter(|p| p.team_id == team_id).map(|p| p.kills).sum(),
                            baron: num(t, "baronKills"),
                            dragon: num(t, "dragonKills"),
                            herald: num(t, "riftHeraldKills"),
                            horde: num(t, "hordeKills"),
                            tower: num(t, "towerKills"),
                            inhibitor: num(t, "inhibitorKills"),
                        },
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let queue_id = num(g, "queueId");
    let game_mode = text(g, "gameMode", 24);
    let early = |p: &Value| p.get("stats").and_then(|s| s.get("gameEndedInEarlySurrender")).and_then(Value::as_bool).unwrap_or(false);
    Some(MatchDto {
        id: format!("{platform}_{game_id}"),
        platform,
        queue_id,
        queue: if game_mode == "CHERRY" { "arena".to_string() } else { queue_category(queue_id).to_string() },
        game_mode,
        game_version: text(g, "gameVersion", 32),
        started_at: g.get("gameCreation").and_then(Value::as_i64).unwrap_or(0),
        duration_sec: num(g, "gameDuration"),
        remake: g.get("participants").and_then(Value::as_array).is_some_and(|a| a.iter().any(early)),
        participants,
        teams,
        gold_at_15: None,
    })
}

/// Parties ARAM Mayhem recentes du compte connecte au client, les plus recentes d'abord.
///
/// - `riot_id` doit etre le compte du client : sinon liste vide (jamais l'historique d'un autre).
/// - `api_puuid` : identifiant du joueur dans l'API Riot. Le client utilise un autre
///   identifiant ; celui du joueur connecte est remplace pour que l'interface le reconnaisse.
/// - `champion_keys` : cle Data Dragon par identifiant de champion.
pub async fn mayhem_matches(lcu: &Lcu, db: &Db, riot_id: &RiotId, api_puuid: &str, count: usize, champion_keys: &HashMap<i32, String>) -> AppResult<Vec<MatchDto>> {
    let me: Value = lcu.get(paths::SUMMONER).await?;
    let same = |k: &str, want: &str| me.get(k).and_then(Value::as_str).is_some_and(|v| v.eq_ignore_ascii_case(want) || v.to_lowercase() == want.to_lowercase());
    if !same("gameName", &riot_id.game_name) || !same("tagLine", &riot_id.tag_line) {
        return Ok(Vec::new());
    }
    let my_client_puuid = text(&me, "puuid", 100);

    let list = lcu.match_history(WINDOW).await?;
    let mut ids: Vec<(i64, u64)> = list
        .get("games")
        .and_then(|g| g.get("games"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|g| g.get("queueId").and_then(Value::as_u64) == Some(MAYHEM_QUEUE))
                .filter_map(|g| Some((g.get("gameCreation").and_then(Value::as_i64).unwrap_or(0), g.get("gameId")?.as_u64()?)))
                .collect()
        })
        .unwrap_or_default();
    ids.sort_by(|a, b| b.0.cmp(&a.0));
    ids.truncate(count);

    let mut out = Vec::with_capacity(ids.len());
    for (_, game_id) in ids {
        let key = format!("lcu:match:v1:{game_id}");
        let cached = db.with(|c| cache::get(c, &key))?.filter(|e| e.fresh).and_then(|e| serde_json::from_str::<MatchDto>(&e.body).ok());
        let mut m = match cached {
            Some(m) => m,
            None => {
                // Une partie illisible ou absente est ignoree : le reste de la liste reste utile.
                let Ok(raw) = lcu.match_history_game(game_id).await else { continue };
                let Some(m) = match_from_client(&raw, &|c| champion_keys.get(&c).cloned()) else { continue };
                // Le champion sans cle (catalogue indisponible) n'est pas mis en cache.
                if m.participants.iter().all(|p| !p.champion.is_empty()) {
                    db.with(|c| cache::put(c, &key, &serde_json::to_string(&m)?, GAME_TTL_SECS))?;
                }
                m
            }
        };
        for p in m.participants.iter_mut().filter(|p| !my_client_puuid.is_empty() && p.puuid == my_client_puuid) {
            p.puuid = api_puuid.to_string();
        }
        out.push(m);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn player(pid: u64, team: u64, champ: i64, win: bool, kills: u64) -> Value {
        json!({
            "participantId": pid, "teamId": team, "championId": champ, "spell1Id": 4, "spell2Id": 32,
            "stats": {
                "win": win, "kills": kills, "deaths": 3, "assists": 7, "champLevel": 18,
                "totalMinionsKilled": 40, "neutralMinionsKilled": 2, "goldEarned": 12000,
                "totalDamageDealtToChampions": 30000, "totalDamageTaken": 20000, "visionScore": 0,
                "item0": 3135, "item1": 3089, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 220013,
                "perk0": 0, "perkPrimaryStyle": 0, "perkSubStyle": 0, "largestMultiKill": 2,
                "gameEndedInEarlySurrender": false, "playerAugment1": 1388
            },
            "timeline": {"lane": "NONE", "role": "SUPPORT"}
        })
    }

    fn game() -> Value {
        json!({
            "gameId": 8040388566u64, "platformId": "EUW1", "queueId": 2400, "gameMode": "KIWI",
            "gameVersion": "16.22.834.8910", "gameCreation": 1794169434768i64, "gameDuration": 1133, "mapId": 12,
            "participants": [player(1, 100, 13, true, 9), player(2, 200, 157, false, 4)],
            "participantIdentities": [
                {"participantId": 1, "player": {"gameName": "Joueur Un", "tagLine": "EUW", "puuid": "11111111-2222-3333-4444-555555555555"}},
                {"participantId": 2, "player": {"gameName": "", "summonerName": "Ancien Nom", "tagLine": "", "puuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}}
            ],
            "teams": [
                {"teamId": 100, "win": "Win", "bans": [], "towerKills": 4, "inhibitorKills": 1, "baronKills": 0, "dragonKills": 0, "riftHeraldKills": 0, "hordeKills": 0},
                {"teamId": 200, "win": "Fail", "bans": [{"championId": 266, "pickTurn": 1}], "towerKills": 1}
            ]
        })
    }

    fn key(id: i32) -> Option<String> {
        match id {
            13 => Some("Ryze".into()),
            157 => Some("Yasuo".into()),
            _ => None,
        }
    }

    #[test]
    fn client_game_becomes_a_match_dto() {
        let m = match_from_client(&game(), &key).unwrap();
        assert_eq!((m.id.as_str(), m.platform.as_str()), ("EUW1_8040388566", "EUW1"));
        // File 2400 : rangee avec les ARAM, mode KIWI conserve pour l'affichage « ARAM Mayhem ».
        assert_eq!((m.queue_id, m.queue.as_str(), m.game_mode.as_str()), (2400, "aram", "KIWI"));
        assert_eq!((m.started_at, m.duration_sec, m.remake), (1794169434768, 1133, false));
        let p = &m.participants[0];
        assert_eq!((p.champion.as_str(), p.game_name.as_str(), p.tag_line.as_str()), ("Ryze", "Joueur Un", "EUW"));
        assert_eq!((p.kills, p.deaths, p.assists, p.cs, p.win), (9, 3, 7, 42, true));
        assert_eq!(p.items, [3135, 3089, 0, 0, 0, 0, 220013]);
        assert_eq!(p.spells, [4, 32]);
        // Pas de runes en Mayhem : rien d'invente. Poste non renseigne hors Faille.
        assert_eq!((p.keystone, p.primary_style, p.perks.len(), p.position.clone()), (None, None, 0, None));
        // Ancien nom d'invocateur utilise quand le Riot ID est vide.
        assert_eq!(m.participants[1].game_name, "Ancien Nom");
        assert_eq!((m.teams[0].win, m.teams[1].win), (true, false));
        assert_eq!((m.teams[0].objectives.champion, m.teams[0].objectives.tower, m.teams[1].bans.clone()), (9, 4, vec![266]));
    }

    #[test]
    fn unreadable_games_are_rejected() {
        assert!(match_from_client(&json!({}), &key).is_none());
        let mut g = game();
        g["platformId"] = json!("../x");
        assert!(match_from_client(&g, &key).is_none(), "plateforme invalide");
        let mut g = game();
        g["participants"] = json!([]);
        assert!(match_from_client(&g, &key).is_none(), "aucun joueur");
        // Champion inconnu du catalogue : cle vide, la partie reste lisible.
        let m = match_from_client(&game(), &|_| None).unwrap();
        assert!(m.participants.iter().all(|p| p.champion.is_empty()));
    }
}
