//! Notation deterministe : base editoriale + bonus de synergie plafonnes + malus justifies.
//!
//! Regles (moteur v1, voir docs/MAYHEM.md) :
//! - la base vient d'une regle editoriale ; sans regle l'augment reste « non evalue » (`?`) ;
//! - chaque mecanique n'est comptee qu'une fois (une condition n'est pas aussi un bonus) ;
//! - bonus plafonnes a +[`BONUS_CAP`], malus a -[`MALUS_CAP`] : pas d'accumulation sans limite ;
//! - les tiers sont absolus (seuils fixes) : la meilleure des trois cartes n'est pas promue ;
//! - la rarete du jeu n'intervient pas.
//! Ce n'est ni un taux de victoire ni une garantie : une appreciation heuristique NEX.

use crate::catalog::MayhemCatalog;
use crate::profile::{ChampionProfile, Mechanic};
use crate::rules::{AugmentRule, ENGINE_VERSION, Orientation, RuleSet, Tier, Validation};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const BONUS_CAP: i32 = 12;
pub const MALUS_CAP: i32 = 24;
const REQUIRE_MISSING: i32 = -18;
const REQUIRE_PARTIAL: i32 = -6;
const REQUIRE_MET: i32 = 3;
const BENEFIT_CENTRAL: i32 = 4;
const BENEFIT_PRESENT: i32 = 2;
const BENEFIT_NONE: i32 = -4;
const ORIENTATION: i32 = 4;
const COMBO: i32 = 5;
const CONFLICT: i32 = -12;
/// Ecart minimal pour designer une meilleure affinite.
pub const BEST_MARGIN: i32 = 6;

pub fn base_points(t: Tier) -> i32 {
    match t {
        Tier::SPlus => 95,
        Tier::S => 85,
        Tier::A => 72,
        Tier::B => 60,
        Tier::C => 46,
        Tier::D => 32,
    }
}

/// Seuils absolus du moteur v1.
pub fn tier_of(score: i32) -> Tier {
    match score {
        s if s >= 90 => Tier::SPlus,
        s if s >= 80 => Tier::S,
        s if s >= 67 => Tier::A,
        s if s >= 54 => Tier::B,
        s if s >= 40 => Tier::C,
        _ => Tier::D,
    }
}

#[derive(Debug, Clone, Default)]
pub struct Context<'a> {
    pub champion: Option<&'a ChampionProfile>,
    /// Mecaniques apportees par les objets reellement connus.
    pub items: BTreeMap<Mechanic, u8>,
    /// Augments deja choisis et confirmes (cles du catalogue).
    pub confirmed: Vec<String>,
    pub orientation: Option<Orientation>,
}

impl Context<'_> {
    fn strength(&self, m: Mechanic) -> u8 {
        let champ = self.champion.map(|c| c.strength(m)).unwrap_or(0);
        // La portee est une propriete du champion, pas des objets.
        let items = if matches!(m, Mechanic::Distance | Mechanic::Melee) { 0 } else { self.items.get(&m).copied().unwrap_or(0) };
        champ.max(items).min(2)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RatingStatus {
    Rated,
    /// Augment identifie mais sans regle editoriale.
    NotEvaluated,
    /// Carte non identifiee.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reason {
    pub text: String,
    pub delta: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rating {
    pub key: Option<String>,
    pub tier: Option<Tier>,
    pub score: Option<i32>,
    pub status: RatingStatus,
    /// Une ou deux raisons courtes, les plus influentes d'abord.
    pub reasons: Vec<Reason>,
    pub validation: Option<Validation>,
    pub engine: u32,
    pub rules_version: Option<String>,
}

fn name(catalog: Option<&MayhemCatalog>, key: &str) -> String {
    catalog.and_then(|c| c.get(key)).map(|a| a.name_fr.clone()).unwrap_or_else(|| key.to_string())
}

fn orientation_label(o: Orientation) -> &'static str {
    match o {
        Orientation::Degats => "dégâts",
        Orientation::Resistance => "résistance",
        Orientation::Soutien => "soutien",
        Orientation::Mobilite => "mobilité",
    }
}

fn evaluate(rule: &AugmentRule, ctx: &Context, catalog: Option<&MayhemCatalog>) -> (i32, Vec<Reason>) {
    let base = base_points(rule.base);
    let mut parts: Vec<Reason> = Vec::new();
    let mut push = |text: String, delta: i32| parts.push(Reason { text, delta });

    if let Some(_champ) = ctx.champion {
        let required: BTreeSet<Mechanic> = rule.requires.iter().copied().collect();
        for &m in &rule.requires {
            match ctx.strength(m) {
                0 => push(format!("difficile à déclencher : peu de {}", m.label()), REQUIRE_MISSING),
                1 => push(format!("déclenchement irrégulier ({})", m.label()), REQUIRE_PARTIAL),
                _ => push(format!("compatible avec tes {}", m.label()), REQUIRE_MET),
            }
        }
        // Une mecanique deja comptee comme condition n'est pas recomptee comme bonus.
        let benefits: Vec<Mechanic> = rule.benefits.iter().copied().filter(|m| !required.contains(m)).collect();
        if !benefits.is_empty() {
            let mut any = false;
            for m in benefits {
                match ctx.strength(m) {
                    2 => {
                        any = true;
                        push(format!("renforce tes {}", m.label()), BENEFIT_CENTRAL);
                    }
                    1 => {
                        any = true;
                        push(format!("profite de tes {}", m.label()), BENEFIT_PRESENT);
                    }
                    _ => {}
                }
            }
            if !any {
                push("peu de synergie avec ton champion et ton build".into(), BENEFIT_NONE);
            }
        }
    }
    if let (Some(o), false) = (ctx.orientation, rule.orientation.is_empty()) {
        if rule.orientation.contains(&o) {
            push(format!("cohérent avec ton orientation {}", orientation_label(o)), ORIENTATION);
        } else {
            push(format!("hors de ton orientation {}", orientation_label(o)), -ORIENTATION);
        }
    }
    let confirmed: BTreeSet<&str> = ctx.confirmed.iter().map(String::as_str).collect();
    for k in rule.combos.iter().filter(|k| confirmed.contains(k.as_str())) {
        push(format!("se combine avec {}", name(catalog, k)), COMBO);
    }
    for k in rule.conflicts.iter().filter(|k| confirmed.contains(k.as_str())) {
        push(format!("redondant ou incompatible avec {}", name(catalog, k)), CONFLICT);
    }

    let bonus: i32 = parts.iter().map(|p| p.delta).filter(|d| *d > 0).sum::<i32>().min(BONUS_CAP);
    let malus: i32 = parts.iter().map(|p| p.delta).filter(|d| *d < 0).sum::<i32>().max(-MALUS_CAP);
    let score = base + bonus + malus;

    // Raisons : les deux contributions les plus fortes (ordre stable a egalite).
    let mut reasons = parts;
    reasons.sort_by_key(|r| std::cmp::Reverse(r.delta.abs()));
    reasons.truncate(2);
    if ctx.champion.is_none() {
        reasons.insert(0, Reason { text: "champion inconnu : base éditoriale seule".into(), delta: 0 });
        reasons.truncate(2);
    }
    if reasons.is_empty() {
        reasons.push(Reason { text: format!("base éditoriale {}", rule.base.label()), delta: 0 });
    }
    (score, reasons)
}

/// Note les cartes proposees, dans leur ordre (gauche -> droite). `None` = carte non identifiee.
pub fn rate(rules: &RuleSet, catalog: Option<&MayhemCatalog>, ctx: &Context, offered: &[Option<&str>]) -> Vec<Rating> {
    let index = rules.index();
    offered
        .iter()
        .map(|o| {
            let blank = |key: Option<String>, status, text: &str| Rating {
                key,
                tier: None,
                score: None,
                status,
                reasons: vec![Reason { text: text.into(), delta: 0 }],
                validation: None,
                engine: ENGINE_VERSION,
                rules_version: Some(rules.version.clone()),
            };
            let Some(key) = o else { return blank(None, RatingStatus::Unknown, "carte non identifiée") };
            if catalog.is_some_and(|c| c.get(key).is_none()) {
                return blank(Some(key.to_string()), RatingStatus::Unknown, "absent du catalogue de ce patch");
            }
            let Some(rule) = index.get(key) else { return blank(Some(key.to_string()), RatingStatus::NotEvaluated, "pas encore évalué") };
            let (score, reasons) = evaluate(rule, ctx, catalog);
            Rating {
                key: Some(key.to_string()),
                tier: Some(tier_of(score)),
                score: Some(score),
                status: RatingStatus::Rated,
                reasons,
                validation: Some(rule.validation.unwrap_or(rules.validation)),
                engine: ENGINE_VERSION,
                rules_version: Some(rules.version.clone()),
            }
        })
        .collect()
}

/// Indice de la meilleure affinite, seulement si au moins deux cartes sont notees et que
/// la premiere devance la deuxieme d'au moins [`BEST_MARGIN`] points. Sinon aucun gagnant.
pub fn best_affinity(ratings: &[Rating]) -> Option<usize> {
    let mut scored: Vec<(usize, i32)> = ratings.iter().enumerate().filter_map(|(i, r)| r.score.map(|s| (i, s))).collect();
    if scored.len() < 2 {
        return None;
    }
    scored.sort_by_key(|(i, s)| (std::cmp::Reverse(*s), *i));
    (scored[0].1 - scored[1].1 >= BEST_MARGIN).then_some(scored[0].0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::ProfileSource;

    fn rules() -> RuleSet {
        RuleSet::parse(
            r#"{"version":"t1","engine":1,"mode":"KIWI","patch":"16.22","reviewedAt":"2026-11-08","validation":"fixture","augments":[
              {"key":"Stun_Bonus","base":"A","requires":["immobilisation"],"benefits":["immobilisation","degats_de_competences"]},
              {"key":"Attack_Stack","base":"B","benefits":["attaques_de_base","vitesse_d_attaque","critique"],"orientation":["degats"]},
              {"key":"Plain_B","base":"B"},
              {"key":"Plain_B2","base":"B"},
              {"key":"Combo_Piece","base":"C","combos":["Attack_Stack"],"conflicts":["Plain_B"]},
              {"key":"Top","base":"S+","benefits":["soins"]}
            ]}"#,
        )
        .unwrap()
    }

    fn champ(m: &[(Mechanic, u8)]) -> ChampionProfile {
        ChampionProfile { key: "X".into(), mechanics: m.iter().copied().collect(), source: ProfileSource::Editorial }
    }

    #[test]
    fn requirement_follows_real_kit() {
        let r = rules();
        let stunner = champ(&[(Mechanic::Immobilisation, 2)]);
        let none = champ(&[]);
        let a = rate(&r, None, &Context { champion: Some(&stunner), ..Default::default() }, &[Some("Stun_Bonus")]);
        let b = rate(&r, None, &Context { champion: Some(&none), ..Default::default() }, &[Some("Stun_Bonus")]);
        // 72 + 3 (condition remplie) - 4 (pas de degats de competences) = 71.
        assert_eq!(a[0].score, Some(71));
        assert_eq!(a[0].tier, Some(Tier::A));
        assert!(a[0].reasons.iter().any(|r| r.text.contains("compatible avec tes immobilisations")));
        // Condition absente : malus, et l'immobilisation n'est pas recomptee en bonus.
        assert_eq!(b[0].score, Some(72 - 18 - 4));
        assert_eq!(b[0].tier, Some(Tier::C));
    }

    #[test]
    fn absolute_tiers_ties_and_no_forced_winner() {
        let r = rules();
        let c = champ(&[]);
        let ctx = Context { champion: Some(&c), ..Default::default() };
        let out = rate(&r, None, &ctx, &[Some("Plain_B"), Some("Plain_B2"), Some("Plain_B")]);
        assert!(out.iter().all(|x| x.tier == Some(Tier::B)), "trois choix moyens restent B");
        assert_eq!(best_affinity(&out), None, "egalite : pas de gagnant invente");
    }

    #[test]
    fn unknown_and_unrated_get_question_mark_never_d() {
        let r = rules();
        let out = rate(&r, None, &Context::default(), &[None, Some("Not_Rated"), Some("Top")]);
        assert_eq!(out[0].status, RatingStatus::Unknown);
        assert_eq!(out[1].status, RatingStatus::NotEvaluated);
        assert!(out[0].tier.is_none() && out[1].tier.is_none());
        assert_eq!(out[2].tier, Some(Tier::SPlus));
        assert_eq!(best_affinity(&out), None, "une seule carte notee");
    }

    #[test]
    fn caps_and_confirmed_augments() {
        let r = rules();
        let adc = champ(&[(Mechanic::AttaquesDeBase, 2), (Mechanic::VitesseDAttaque, 2), (Mechanic::Critique, 2)]);
        let ctx = Context { champion: Some(&adc), orientation: Some(Orientation::Degats), ..Default::default() };
        let out = rate(&r, None, &ctx, &[Some("Attack_Stack")]);
        // 4+4+4 (benefices) + 4 (orientation) = 16, plafonne a +12.
        assert_eq!(out[0].score, Some(60 + BONUS_CAP));
        assert_eq!(out[0].reasons.len(), 2);
        // Les augments confirmes ne changent que les cartes concernees.
        let before = rate(&r, None, &ctx, &[Some("Combo_Piece"), Some("Plain_B2")]);
        let ctx2 = Context { confirmed: vec!["Attack_Stack".into()], ..ctx.clone() };
        let after = rate(&r, None, &ctx2, &[Some("Combo_Piece"), Some("Plain_B2")]);
        assert_eq!(after[0].score.unwrap() - before[0].score.unwrap(), COMBO);
        assert_eq!(after[1], before[1]);
        let ctx3 = Context { confirmed: vec!["Plain_B".into()], ..ctx };
        assert!(rate(&r, None, &ctx3, &[Some("Combo_Piece")])[0].reasons[0].text.contains("incompatible"));
    }

    #[test]
    fn best_affinity_needs_clear_margin() {
        let r = rules();
        let c = champ(&[(Mechanic::Soins, 2)]);
        let ctx = Context { champion: Some(&c), ..Default::default() };
        let out = rate(&r, None, &ctx, &[Some("Plain_B"), Some("Top"), Some("Plain_B2")]);
        assert_eq!(best_affinity(&out), Some(1));
        // Determinisme : meme entree, meme sortie.
        assert_eq!(out, rate(&r, None, &ctx, &[Some("Plain_B"), Some("Top"), Some("Plain_B2")]));
    }
}
