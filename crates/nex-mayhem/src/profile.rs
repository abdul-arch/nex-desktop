//! Mecaniques d'un champion et des objets connus, avec leur provenance.
//!
//! Profil heuristique : derive des donnees Data Dragon (etiquettes, portee, ressource, textes
//! des competences en anglais). C'est une approximation explicable, signalee comme telle ; un
//! profil edite (verifie a la main) la remplace quand il existe.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mechanic {
    /// Etourdissements, entraves, projections, suppressions, charmes, peurs...
    Immobilisation,
    AttaquesDeBase,
    EffetsALImpact,
    Critique,
    VitesseDAttaque,
    DegatsDeCompetences,
    Soins,
    Boucliers,
    Mana,
    Distance,
    Melee,
    Resistance,
    Mobilite,
}

impl Mechanic {
    pub fn label(self) -> &'static str {
        match self {
            Self::Immobilisation => "immobilisations",
            Self::AttaquesDeBase => "attaques de base",
            Self::EffetsALImpact => "effets à l'impact",
            Self::Critique => "coups critiques",
            Self::VitesseDAttaque => "vitesse d'attaque",
            Self::DegatsDeCompetences => "dégâts de compétences",
            Self::Soins => "soins",
            Self::Boucliers => "boucliers",
            Self::Mana => "mana",
            Self::Distance => "portée (distance)",
            Self::Melee => "corps à corps",
            Self::Resistance => "résistance",
            Self::Mobilite => "mobilité",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileSource {
    /// Derive automatiquement des donnees Data Dragon.
    DataDragonHeuristic,
    /// Edite et verifie a la main.
    Editorial,
}

/// Intensite par mecanique : 0 absent, 1 present, 2 central dans le kit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionProfile {
    pub key: String,
    pub mechanics: BTreeMap<Mechanic, u8>,
    pub source: ProfileSource,
}

impl ChampionProfile {
    pub fn strength(&self, m: Mechanic) -> u8 {
        self.mechanics.get(&m).copied().unwrap_or(0).min(2)
    }
}

const CC: &[&str] = &[
    "stun", "root", "snare", "knock up", "knocks up", "knocked up", "airborne", "knock back", "knocks back", "suppress", "charm", "taunt", "fear", "flee", "sleep",
    "polymorph", "immobiliz", "pulls",
];
const HEAL: &[&str] = &["heal", "restores health", "restore health", "regenerat"];
const SHIELD: &[&str] = &["shield"];
const ATTACK: &[&str] = &["basic attack", "next attack", "attacks "];
const ONHIT: &[&str] = &["on-hit", "on hit"];
const CRIT: &[&str] = &["critical strike", "crit"];
const ASPEED: &[&str] = &["attack speed"];
const DASH: &[&str] = &["dash", "blink", "leap", "teleport", "lunge"];

fn texts(c: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(p) = c.get("passive").and_then(|p| p.get("description")).and_then(Value::as_str) {
        out.push(p.to_lowercase());
    }
    if let Some(spells) = c.get("spells").and_then(Value::as_array) {
        for s in spells {
            let d = s.get("description").and_then(Value::as_str).unwrap_or("");
            let t = s.get("tooltip").and_then(Value::as_str).unwrap_or("");
            out.push(format!("{d} {t}").to_lowercase());
        }
    }
    out
}

/// Nombre de textes (passif + 4 sorts) contenant au moins un des mots.
fn count(texts: &[String], words: &[&str]) -> usize {
    texts.iter().filter(|t| words.iter().any(|w| t.contains(w))).count()
}

fn level(n: usize, central: usize) -> u8 {
    if n >= central {
        2
    } else if n >= 1 {
        1
    } else {
        0
    }
}

/// Profil heuristique d'apres la fiche Data Dragon d'un champion (objet `data[<cle>]`, en anglais).
pub fn from_data_dragon(champion: &Value) -> Option<ChampionProfile> {
    let key = champion.get("id").and_then(Value::as_str)?.to_string();
    let tags: Vec<&str> = champion.get("tags").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let has = |t: &str| tags.contains(&t);
    let info = champion.get("info");
    let info_v = |k: &str| info.and_then(|i| i.get(k)).and_then(Value::as_u64).unwrap_or(0);
    let range = champion.get("stats").and_then(|s| s.get("attackrange")).and_then(Value::as_f64).unwrap_or(0.0);
    let partype = champion.get("partype").and_then(Value::as_str).unwrap_or("");
    let t = texts(champion);

    let mut m = BTreeMap::new();
    let mut set = |k: Mechanic, v: u8| {
        if v > 0 {
            m.insert(k, v.min(2));
        }
    };
    set(Mechanic::Immobilisation, level(count(&t, CC), 2));
    set(Mechanic::Soins, level(count(&t, HEAL), 2));
    set(Mechanic::Boucliers, level(count(&t, SHIELD), 2));
    set(Mechanic::AttaquesDeBase, if has("Marksman") { 2 } else { level(count(&t, ATTACK), 2) });
    set(Mechanic::EffetsALImpact, level(count(&t, ONHIT), 2));
    set(Mechanic::Critique, if count(&t, CRIT) > 0 { 2 } else { u8::from(has("Marksman")) });
    set(Mechanic::VitesseDAttaque, if has("Marksman") { 1.max(level(count(&t, ASPEED), 1)) } else { level(count(&t, ASPEED), 2) });
    set(Mechanic::DegatsDeCompetences, if has("Mage") || info_v("magic") >= 7 { 2 } else { u8::from(info_v("magic") >= 4) });
    set(Mechanic::Mana, if partype == "Mana" { if has("Mage") || has("Support") { 2 } else { 1 } } else { 0 });
    set(Mechanic::Distance, if range >= 400.0 { 2 } else { 0 });
    set(Mechanic::Melee, if range > 0.0 && range < 300.0 { 2 } else { 0 });
    set(Mechanic::Resistance, if has("Tank") || info_v("defense") >= 7 { 2 } else { u8::from(info_v("defense") >= 5 || has("Fighter")) });
    set(Mechanic::Mobilite, level(count(&t, DASH), 2));
    Some(ChampionProfile { key, mechanics: m, source: ProfileSource::DataDragonHeuristic })
}

/// Mecaniques apportees par les objets connus (etiquettes Data Dragon des objets).
pub fn from_item_tags(tags: &[&str]) -> BTreeMap<Mechanic, u8> {
    let mut m: BTreeMap<Mechanic, u8> = BTreeMap::new();
    for t in tags {
        let k = match *t {
            "CriticalStrike" => Mechanic::Critique,
            "OnHit" => Mechanic::EffetsALImpact,
            "AttackSpeed" => Mechanic::VitesseDAttaque,
            "SpellDamage" => Mechanic::DegatsDeCompetences,
            "Health" | "Armor" | "SpellBlock" => Mechanic::Resistance,
            "Mana" | "ManaRegen" => Mechanic::Mana,
            _ => continue,
        };
        // Un objet rend une mecanique presente (1) ; deux objets la rendent centrale (2).
        let e = m.entry(k).or_insert(0);
        *e = (*e + 1).min(2);
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn derives_profile_from_kit_text() {
        let c = json!({
            "id": "Leona", "tags": ["Tank", "Support"], "partype": "Mana",
            "info": {"defense": 8, "magic": 3}, "stats": {"attackrange": 125.0},
            "passive": {"description": "Damaging spells mark enemies."},
            "spells": [
                {"description": "Leona's next basic attack stuns the target."},
                {"description": "Leona gains armor."},
                {"description": "Leona dashes and roots the enemy."},
                {"description": "Enemies in the center are stunned."}
            ]
        });
        let p = from_data_dragon(&c).unwrap();
        assert_eq!(p.strength(Mechanic::Immobilisation), 2);
        assert_eq!(p.strength(Mechanic::Melee), 2);
        assert_eq!(p.strength(Mechanic::Distance), 0);
        assert_eq!(p.strength(Mechanic::Resistance), 2);
        assert_eq!(p.strength(Mechanic::Critique), 0);
        assert_eq!(p.source, ProfileSource::DataDragonHeuristic);
    }

    #[test]
    fn item_tags_are_capped() {
        let m = from_item_tags(&["CriticalStrike", "CriticalStrike", "CriticalStrike", "Damage"]);
        assert_eq!(m.get(&Mechanic::Critique), Some(&2));
        assert_eq!(m.len(), 1);
    }
}
