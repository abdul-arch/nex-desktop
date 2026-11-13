//! Mode spectateur via le client League.
//!
//! Constats sur un client reel (novembre 2026) :
//! - le lancement exige une `spectatorKey` ; celle de l'API Riot (spectator-v5
//!   `observers.encryptionKey`) est refusee par les serveurs Riot (erreur 500) ;
//! - la cle acceptee est celle de la presence des amis (`lol.spectatorKey`, 24 caracteres),
//!   donc seules les parties des amis peuvent etre regardees depuis le client ;
//! - l'identifiant attendu est le `puuid` du chat (UUID de 36 caracteres), different du PUUID
//!   de l'API Riot (78 caracteres) : la correspondance se fait par Riot ID ;
//! - lancer directement l'executable du jeu est bloque (acces refuse) : ce n'est pas tente.

use crate::adapters::lcu::{Lcu, paths};
use crate::error::{AppError, AppResult};
use nex_domain::riot::RiotId;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct ObservableFriend {
    /// « Pseudo#TAG » tel qu'affiche par Riot.
    pub riot_id: String,
    /// Identifiant du chat (UUID), attendu par le client pour le mode spectateur.
    chat_puuid: String,
    key: String,
}

/// UUID du chat : 36 caracteres hexadecimaux et tirets.
fn valid_chat_puuid(s: &str) -> bool {
    s.len() == 36 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

/// Amis en partie observable, avec un Riot ID, un identifiant et une cle valides.
pub fn observable(friends: &[Value]) -> Vec<ObservableFriend> {
    friends
        .iter()
        .filter_map(|f| {
            let lol = f.get("lol")?;
            let in_game = lol.get("gameStatus").and_then(Value::as_str) == Some("inGame");
            let open = lol.get("isObservable").and_then(Value::as_str) == Some("ALL");
            let key = lol.get("spectatorKey")?.as_str()?;
            let chat_puuid = f.get("puuid")?.as_str()?;
            let id = RiotId::new(f.get("gameName")?.as_str()?, f.get("gameTag")?.as_str()?).ok()?;
            (in_game && open && valid_chat_puuid(chat_puuid) && nex_domain::api::valid_spectator_key(key)).then(|| ObservableFriend {
                riot_id: format!("{}#{}", id.game_name, id.tag_line),
                chat_puuid: chat_puuid.to_string(),
                key: key.to_string(),
            })
        })
        .collect()
}

fn same_riot_id(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// Riot ID des amis dont la partie peut etre regardee maintenant.
pub async fn observable_friends(lcu: &Lcu) -> AppResult<Vec<String>> {
    let friends: Vec<Value> = lcu.get(paths::FRIENDS).await?;
    Ok(observable(&friends).into_iter().map(|f| f.riot_id).collect())
}

/// Ouvre la partie d'un ami en spectateur (action du joueur).
pub async fn launch(lcu: &Lcu, riot_id: &RiotId) -> AppResult<()> {
    let wanted = format!("{}#{}", riot_id.game_name, riot_id.tag_line);
    let friends: Vec<Value> = lcu.get(paths::FRIENDS).await?;
    let friend = observable(&friends).into_iter().find(|f| same_riot_id(&f.riot_id, &wanted)).ok_or_else(|| {
        AppError::Unavailable(
            "le client League ne permet de regarder que les parties de tes amis (joueur absent de ta liste d'amis, pas en partie ou partie non observable)".into(),
        )
    })?;
    lcu.spectate(&friend.chat_puuid, &friend.key).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_observable_friends_in_game() {
        let uuid = "0f0e5a3c-1b2d-4c5e-8f9a-0123456789ab";
        let key = "Abc123+/=xyzABC123456789";
        let friend = |name: &str, status: &str, obs: &str, k: &str, puuid: &str| {
            json!({"gameName": name, "gameTag": "EUW", "puuid": puuid, "lol": {"gameStatus": status, "isObservable": obs, "spectatorKey": k}})
        };
        let friends = vec![
            friend("Alpha", "inGame", "ALL", key, uuid),
            friend("Bravo", "inGame", "NONE", key, uuid),
            friend("Charlie", "outOfGame", "ALL", "", uuid),
            friend("Delta", "inGame", "ALL", "bad key!", uuid),
            // PUUID de l'API Riot (78 caracteres) au lieu de l'UUID du chat : refuse.
            friend("Echo", "inGame", "ALL", key, &"a".repeat(78)),
            friend("X", "inGame", "ALL", key, uuid),
            json!({"gameName": "Foxtrot", "gameTag": "EUW"}),
        ];
        let o = observable(&friends);
        assert_eq!(o.len(), 1);
        assert_eq!(o[0].riot_id, "Alpha#EUW");
        assert_eq!(o[0].chat_puuid, uuid);
        assert!(same_riot_id("alpha#euw", &o[0].riot_id));
    }
}
