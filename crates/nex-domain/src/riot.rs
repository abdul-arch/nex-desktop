//! Identite Riot : saisie par Riot ID (`Pseudo#TAG`), identite technique par PUUID,
//! routage par plateforme (summoner-v4, league-v4) ou par region (account-v1, match-v5).

use crate::{DomainResult, InvalidInput};
use serde::{Deserialize, Serialize};

fn invalid<T>(msg: impl Into<String>) -> DomainResult<T> {
    Err(InvalidInput(msg.into()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiotId {
    pub game_name: String,
    pub tag_line: String,
}

impl RiotId {
    /// Regles Riot : nom 3 a 16 caracteres, tag 3 a 5 caracteres alphanumeriques.
    pub fn new(game_name: &str, tag_line: &str) -> DomainResult<Self> {
        let name = game_name.trim();
        let tag = tag_line.trim().trim_start_matches('#');
        let name_len = name.chars().count();
        if !(3..=16).contains(&name_len) {
            return invalid("le pseudo doit contenir entre 3 et 16 caracteres");
        }
        if name.contains('#') || name.contains('/') || name.chars().any(|c| c.is_control()) {
            return invalid("pseudo invalide");
        }
        let tag_len = tag.chars().count();
        if !(3..=5).contains(&tag_len) || !tag.chars().all(|c| c.is_alphanumeric()) {
            return invalid("le tag doit contenir 3 a 5 caracteres alphanumeriques");
        }
        Ok(Self {
            game_name: name.to_string(),
            tag_line: tag.to_string(),
        })
    }

    /// Analyse `Pseudo#TAG`.
    pub fn parse(input: &str) -> DomainResult<Self> {
        match input.rsplit_once('#') {
            Some((name, tag)) => Self::new(name, tag),
            None => invalid("format attendu : Pseudo#TAG"),
        }
    }
}

/// PUUID Riot : 78 caracteres base64url dans la pratique ; on accepte 40 a 100.
pub fn validate_puuid(puuid: &str) -> DomainResult<&str> {
    let ok = (40..=100).contains(&puuid.len())
        && puuid.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok { Ok(puuid) } else { invalid("PUUID invalide") }
}

/// Identifiant de match : `EUW1_7123456789`.
pub fn validate_match_id(id: &str) -> DomainResult<&str> {
    let Some((prefix, num)) = id.split_once('_') else {
        return invalid("identifiant de match invalide");
    };
    let ok = (2..=5).contains(&prefix.len())
        && prefix.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        && (5..=15).contains(&num.len())
        && num.bytes().all(|b| b.is_ascii_digit());
    if ok { Ok(id) } else { invalid("identifiant de match invalide") }
}

/// Plateformes LoL (routage "platform").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    Euw1,
    Eun1,
    Tr1,
    Ru,
    Me1,
    Na1,
    Br1,
    La1,
    La2,
    Kr,
    Jp1,
    Oc1,
    Sg2,
    Tw2,
    Vn2,
}

/// Routage regional.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RegionalRoute {
    Americas,
    Asia,
    Europe,
    Sea,
}

impl RegionalRoute {
    pub fn host(self) -> &'static str {
        match self {
            RegionalRoute::Americas => "americas",
            RegionalRoute::Asia => "asia",
            RegionalRoute::Europe => "europe",
            RegionalRoute::Sea => "sea",
        }
    }
}

impl Platform {
    pub const ALL: [Platform; 15] = [
        Platform::Euw1,
        Platform::Eun1,
        Platform::Tr1,
        Platform::Ru,
        Platform::Me1,
        Platform::Na1,
        Platform::Br1,
        Platform::La1,
        Platform::La2,
        Platform::Kr,
        Platform::Jp1,
        Platform::Oc1,
        Platform::Sg2,
        Platform::Tw2,
        Platform::Vn2,
    ];

    pub fn code(self) -> &'static str {
        match self {
            Platform::Euw1 => "EUW1",
            Platform::Eun1 => "EUN1",
            Platform::Tr1 => "TR1",
            Platform::Ru => "RU",
            Platform::Me1 => "ME1",
            Platform::Na1 => "NA1",
            Platform::Br1 => "BR1",
            Platform::La1 => "LA1",
            Platform::La2 => "LA2",
            Platform::Kr => "KR",
            Platform::Jp1 => "JP1",
            Platform::Oc1 => "OC1",
            Platform::Sg2 => "SG2",
            Platform::Tw2 => "TW2",
            Platform::Vn2 => "VN2",
        }
    }

    /// Hote des API "platform" (summoner-v4, league-v4, spectator-v5).
    pub fn host(self) -> String {
        self.code().to_ascii_lowercase()
    }

    pub fn parse(code: &str) -> DomainResult<Self> {
        match Platform::ALL
            .into_iter()
            .find(|p| p.code().eq_ignore_ascii_case(code.trim()))
        {
            Some(p) => Ok(p),
            None => invalid(format!("region inconnue : {code}")),
        }
    }

    /// Routage match-v5.
    pub fn regional(self) -> RegionalRoute {
        match self {
            Platform::Na1 | Platform::Br1 | Platform::La1 | Platform::La2 => RegionalRoute::Americas,
            Platform::Kr | Platform::Jp1 => RegionalRoute::Asia,
            Platform::Euw1 | Platform::Eun1 | Platform::Tr1 | Platform::Ru | Platform::Me1 => {
                RegionalRoute::Europe
            }
            Platform::Oc1 | Platform::Sg2 | Platform::Tw2 | Platform::Vn2 => RegionalRoute::Sea,
        }
    }

    /// Routage account-v1 : seuls americas, asia et europe sont servis ;
    /// les plateformes SEA utilisent asia (le compte est global).
    pub fn account_route(self) -> RegionalRoute {
        match self.regional() {
            RegionalRoute::Sea => RegionalRoute::Asia,
            r => r,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_riot_id() {
        let id = RiotId::parse("  Faker#KR1 ").unwrap();
        assert_eq!(id.game_name, "Faker");
        assert_eq!(id.tag_line, "KR1");
    }

    #[test]
    fn parse_keeps_unicode_names() {
        assert_eq!(RiotId::parse("Élodie Ça#EUW").unwrap().game_name, "Élodie Ça");
    }

    #[test]
    fn rejects_bad_riot_ids() {
        for bad in ["NoTag", "ab#EUW", "Player#E", "Player#EU-W", "A#B#EUW", "NomBeaucoupTropLong#EUW", "a/../b#EUW"] {
            assert!(RiotId::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn routing() {
        assert_eq!(Platform::parse("euw1").unwrap().regional(), RegionalRoute::Europe);
        assert_eq!(Platform::parse("OC1").unwrap().regional(), RegionalRoute::Sea);
        assert_eq!(Platform::Oc1.account_route(), RegionalRoute::Asia);
        assert_eq!(Platform::Kr.host(), "kr");
        assert!(Platform::parse("XX9").is_err());
    }

    #[test]
    fn ids() {
        assert!(validate_match_id("EUW1_7123456789").is_ok());
        assert!(validate_match_id("euw1_7123").is_err());
        assert!(validate_match_id("EUW1_12/../3").is_err());
        let puuid = "a".repeat(78);
        assert!(validate_puuid(&puuid).is_ok());
        assert!(validate_puuid("abc").is_err());
        assert!(validate_puuid(&format!("{}/x", "a".repeat(50))).is_err());
    }
}
