//! Regles de notation : donnees versionnees et validees, jamais executees comme du code.
//! Le catalogue decrit les augments ; ces regles les evaluent. Un augment sans regle reste
//! « non evalue » (note `?`), il ne recoit jamais de valeur inventee.

use crate::profile::Mechanic;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Version du moteur : les fichiers de regles doivent la declarer.
pub const ENGINE_VERSION: u32 = 1;

/// Base editoriale publiee avec NEX (relue). Vide tant qu'aucune evaluation n'est validee :
/// les augments restent « non evalues » plutot que de recevoir une note inventee.
pub const EDITORIAL_RULES: &str = include_str!("../rules/editorial.v1.json");
/// Donnees d'essai : tests et apercu « DEMO » uniquement, jamais appliquees a une vraie partie.
pub const FIXTURE_RULES: &str = include_str!("../rules/fixtures.v1.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Tier {
    #[serde(rename = "D")]
    D,
    #[serde(rename = "C")]
    C,
    #[serde(rename = "B")]
    B,
    #[serde(rename = "A")]
    A,
    #[serde(rename = "S")]
    S,
    #[serde(rename = "S+")]
    SPlus,
}

impl Tier {
    pub fn label(self) -> &'static str {
        match self {
            Self::SPlus => "S+",
            Self::S => "S",
            Self::A => "A",
            Self::B => "B",
            Self::C => "C",
            Self::D => "D",
        }
    }
}

/// Orientation de jeu choisie par le joueur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Orientation {
    Degats,
    Resistance,
    Soutien,
    Mobilite,
}

/// Niveau de validation des conseils (independant de la confiance d'identification).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Validation {
    /// Donnees d'essai : interface et moteur, jamais presentees comme un catalogue evalue.
    Fixture,
    /// Base editee par le joueur dans NEX (non relue par un tiers).
    LocalEditorial,
    /// Base editoriale relue et publiee avec NEX.
    Editorial,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AugmentRule {
    /// `augmentNameId` du catalogue.
    pub key: String,
    /// Base editoriale (valeur hors contexte).
    pub base: Tier,
    /// Conditions de declenchement : sans elles, l'effet est difficile a obtenir.
    #[serde(default)]
    pub requires: Vec<Mechanic>,
    /// Mecaniques qui renforcent l'effet.
    #[serde(default)]
    pub benefits: Vec<Mechanic>,
    #[serde(default)]
    pub orientation: Vec<Orientation>,
    /// Augments qui se combinent bien (cles du catalogue).
    #[serde(default)]
    pub combos: Vec<String>,
    /// Augments incompatibles ou redondants.
    #[serde(default)]
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// Validation propre a cette regle (sinon celle du jeu de regles).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validation: Option<Validation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSet {
    /// Identifiant de version du jeu de regles (ex. `fixtures-2026.11.08`).
    pub version: String,
    pub engine: u32,
    pub mode: String,
    pub patch: String,
    pub reviewed_at: String,
    pub validation: Validation,
    pub augments: Vec<AugmentRule>,
}

fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 80 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn short(s: &str, max: usize) -> bool {
    s.chars().count() <= max && !s.chars().any(char::is_control)
}

impl RuleSet {
    /// Valide un jeu de regles charge (fichier embarque, import ou base locale).
    pub fn parse(json: &str) -> Result<Self, String> {
        let r: RuleSet = serde_json::from_str(json).map_err(|e| format!("règles illisibles : {e}"))?;
        r.validate()?;
        Ok(r)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.engine != ENGINE_VERSION {
            return Err(format!("règles prévues pour le moteur v{}, moteur actuel v{ENGINE_VERSION}", self.engine));
        }
        if self.mode != "KIWI" {
            return Err("règles d'un autre mode : non transposées à ARAM Mayhem".into());
        }
        if !short(&self.version, 60) || !short(&self.patch, 40) || !short(&self.reviewed_at, 40) {
            return Err("en-tête des règles invalide".into());
        }
        if self.augments.len() > 2000 {
            return Err("trop de règles".into());
        }
        let mut seen = std::collections::BTreeSet::new();
        for a in &self.augments {
            if !valid_key(&a.key) || !seen.insert(a.key.as_str()) {
                return Err(format!("règle invalide ou en double : {}", a.key));
            }
            let lists_ok = a.requires.len() <= 6 && a.benefits.len() <= 8 && a.orientation.len() <= 4 && a.combos.len() <= 12 && a.conflicts.len() <= 12;
            if !lists_ok || !a.combos.iter().chain(&a.conflicts).all(|k| valid_key(k)) || !a.note.as_deref().is_none_or(|n| short(n, 160)) {
                return Err(format!("règle invalide : {}", a.key));
            }
        }
        Ok(())
    }

    pub fn index(&self) -> BTreeMap<&str, &AugmentRule> {
        self.augments.iter().map(|a| (a.key.as_str(), a)).collect()
    }

    /// Superpose des regles locales (edition du joueur) a cette base : une regle locale
    /// remplace celle de meme cle et porte la validation « edition locale ».
    pub fn with_local(&self, local: &[AugmentRule]) -> RuleSet {
        let mut out = self.clone();
        for l in local {
            let mut r = l.clone();
            r.validation = Some(Validation::LocalEditorial);
            match out.augments.iter_mut().find(|a| a.key == r.key) {
                Some(a) => *a = r,
                None => out.augments.push(r),
            }
        }
        if !local.is_empty() {
            out.version = format!("{}+local{}", self.version, local.len());
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(extra: &str) -> String {
        format!(
            r#"{{"version":"t","engine":1,"mode":"KIWI","patch":"16.22","reviewedAt":"2026-11-08","validation":"fixture","augments":[
            {{"key":"A_One","base":"B","requires":["immobilisation"]}}{extra}]}}"#
        )
    }

    #[test]
    fn embedded_rules_are_valid_and_separate() {
        let ed = RuleSet::parse(EDITORIAL_RULES).unwrap();
        assert!(ed.augments.is_empty(), "aucune note publiee sans relecture");
        assert_eq!(ed.validation, Validation::Editorial);
        let fx = RuleSet::parse(FIXTURE_RULES).unwrap();
        assert_eq!(fx.validation, Validation::Fixture);
        let local = vec![AugmentRule { key: "GlassCannon".into(), base: Tier::C, requires: vec![], benefits: vec![], orientation: vec![], combos: vec![], conflicts: vec![], note: None, validation: None }];
        let merged = ed.with_local(&local);
        assert_eq!(merged.augments[0].validation, Some(Validation::LocalEditorial));
        assert!(merged.version.contains("local"));
    }

    #[test]
    fn validates_rules() {
        assert!(RuleSet::parse(&sample("")).is_ok());
        assert!(RuleSet::parse(&sample(r#",{"key":"A_One","base":"C"}"#)).is_err(), "doublon");
        assert!(RuleSet::parse(&sample(r#",{"key":"bad key","base":"C"}"#)).is_err());
        assert!(RuleSet::parse(&sample(r#",{"key":"X","base":"Z"}"#)).is_err(), "tier inconnu");
        assert!(RuleSet::parse(&sample("").replace("KIWI", "CHERRY")).is_err(), "Arena non transposee");
        assert!(RuleSet::parse(&sample("").replace("\"engine\":1", "\"engine\":9")).is_err());
    }
}
