//! Cas de reference de la specification, verifies sur un extrait date de l'export public
//! arammayhem.com (publication du 8 novembre 2026, « Data: arammayhem.com », CC BY 4.0) et sur
//! le catalogue Riot KIWI 16.22. La source ne publie que la popularite et les combos : NEX
//! n'invente aucune note et affiche un contexte borne, date et attribue.

use nex_mayhem::provider::{CardContext, ComboStatus, Dataset, MappingStatus, card_context, mapped, parse_arammayhem};
use nex_mayhem::rules::EDITORIAL_RULES;
use nex_mayhem::{Context, MayhemCatalog, Rating, RatingStatus, RuleSet, best_affinity, rate};
use serde_json::Value;

fn load(name: &str) -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name);
    let text = std::fs::read_to_string(p).unwrap();
    serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap()
}

fn catalog() -> MayhemCatalog {
    serde_json::from_value(load("catalog-kiwi-16.22.json")).unwrap()
}

fn dataset() -> Dataset {
    let v = load("arammayhem-2026-11-08.json");
    let raw = parse_arammayhem(&v["index"], &v["augments"], &v["champions"], &v["combos"], 0).unwrap();
    mapped(&raw, &catalog())
}

/// Notes de production : base editoriale publiee seulement (jamais les donnees d'essai).
fn rate_production(offered: &[&str], confirmed: &[&str]) -> Vec<Rating> {
    let rules = RuleSet::parse(EDITORIAL_RULES).unwrap();
    let ctx = Context { champion: None, items: Default::default(), confirmed: confirmed.iter().map(|s| s.to_string()).collect(), orientation: None };
    let cat = catalog();
    rate(&rules, Some(&cat), &ctx, &offered.iter().map(|k| Some(*k)).collect::<Vec<_>>())
}

fn ctx(champion: &str, key: &str, confirmed: &[&str]) -> CardContext {
    let confirmed: Vec<String> = confirmed.iter().map(|s| s.to_string()).collect();
    card_context(Some(&dataset()), Some(champion), Some(key), &confirmed)
}

#[test]
fn dated_export_coverage_and_capabilities() {
    let ds = dataset();
    assert_eq!(ds.provenance.release_id.as_deref(), Some("website:20261108_104035:3df69243a697"));
    assert_eq!((ds.provenance.patch.as_deref(), ds.provenance.stats_date.as_deref()), (Some("26.22"), Some("2026-11-07")));
    assert_eq!(ds.provenance.attribution, "Data: arammayhem.com");
    // Popularite et combos seulement : aucune capacite de tier ni de build.
    let caps = ds.capabilities;
    assert!(caps.popularity && caps.combos && !caps.global_tiers && !caps.champion_augment_tiers && !caps.builds);
    let count = |m: MappingStatus| ds.augments.iter().filter(|a| a.mapping == m).count();
    assert_eq!(ds.augments.len(), 213);
    let unmapped: Vec<&str> = ds.augments.iter().filter(|a| a.mapping == MappingStatus::Unmapped).map(|a| a.provider_id.as_str()).collect();
    // Absents du catalogue Riot 16.22 (dont deux marques retires par la source).
    assert_eq!(unmapped, vec!["void_immolation", "double_defense", "rabble_rousing"]);
    assert_eq!((count(MappingStatus::Exact), count(MappingStatus::Alias), count(MappingStatus::Ambiguous), count(MappingStatus::Unmapped)), (207, 3, 0, 3));
    assert_eq!(ds.anomalies.iter().filter(|a| a.contains("retiré")).count(), 3, "retires encore mesures : signales");
}

#[test]
fn yasuo_upgrade_deaths_dance_gets_no_borrowed_tier() {
    // Cas « S- / A+ » : tiers champion-augment non publies sous licence -> pas de note.
    let r = &rate_production(&["Upgrade_DeathDance"], &[])[0];
    assert_eq!((r.status, r.tier), (RatingStatus::NotEvaluated, None));
    let c = ctx("Yasuo", "Upgrade_DeathDance", &[]);
    let pop = c.popularity.unwrap();
    assert_eq!((pop.pick_rate, pop.pick_rate_rank, pop.rank_scope), (Some(25.71), Some(49), 213));
    assert!(c.combos.is_empty(), "aucun combo de la source pour Yasuo avec cet augment");
}

#[test]
fn ryze_overflow_vs_transmute_popularity_is_not_a_tier() {
    let r = rate_production(&["ARAM_Overflow", "ARAM_TransmutePrismatic"], &[]);
    assert!(r.iter().all(|x| x.status == RatingStatus::NotEvaluated && x.tier.is_none() && x.score.is_none()));
    assert_eq!(best_affinity(&r), None, "aucune meilleure affinite sans note");
    let (oc, tc) = (ctx("Ryze", "ARAM_Overflow", &[]), ctx("Ryze", "ARAM_TransmutePrismatic", &[]));
    let (o, t) = (oc.popularity.clone().unwrap(), tc.popularity.clone().unwrap());
    assert_eq!((o.pick_rate_rank, t.pick_rate_rank), (Some(133), Some(1)));
    // La source etiquette « god » le combo « Overflow seul » pour Ryze : information, sans bonus.
    let solo = &oc.combos[0];
    assert_eq!((solo.status, solo.size, solo.types.clone()), (ComboStatus::Active, 1, vec!["god".to_string()]));
    assert!(tc.combos.is_empty(), "aucun combo de la source pour Ryze avec Transmute: Prismatic");
}

#[test]
fn king_me_low_popularity_never_becomes_d() {
    let r = &rate_production(&["KingMe"], &[])[0];
    assert_eq!((r.status, r.tier), (RatingStatus::NotEvaluated, None));
    let pop = ctx("Ryze", "KingMe", &[]).popularity.unwrap();
    assert_eq!((pop.pick_rate, pop.pick_rate_rank), (Some(4.13), Some(187)));
}

#[test]
fn ryze_adapt_with_mind_to_matter_orders_real_combos_first() {
    let c = ctx("Ryze", "ARAM_ADAPt", &["ARAM_MindtoMatter"]);
    // Combo 9 : ADAPt seul (« god ») ; combo 1082 : ADAPt + Mind to Matter, realisable.
    assert_eq!((c.combos[0].combo_id, c.combos[0].status, c.combos[0].size), (9, ComboStatus::Active, 1));
    assert_eq!(c.combos[0].types, vec!["god".to_string()]);
    assert_eq!((c.combos[1].combo_id, c.combos[1].status, c.combos[1].size), (1082, ComboStatus::Active, 2));
    assert!(c.combos[2..].iter().all(|n| n.status == ComboStatus::Project));
    // Combos historiques (Void Rift, Vampirism : absents du patch) masques et comptes.
    assert_eq!((c.combos_total, c.combos_outside_pool), (12, 2));
    assert!(c.combos.iter().all(|n| n.missing.iter().all(|m| m != "void_rift" && m != "vampirism")));
    // Sans Mind to Matter confirme, 1082 redevient un projet.
    let without = ctx("Ryze", "ARAM_ADAPt", &[]);
    let p = without.combos.iter().find(|n| n.combo_id == 1082).unwrap();
    assert_eq!((p.status, p.missing.clone()), (ComboStatus::Project, vec!["ARAM_MindtoMatter".to_string()]));
}

#[test]
fn bug_tagged_interactions_are_flagged_and_historical_ones_hidden() {
    let elise = ctx("Elise", "ARAM_Dashing", &[]);
    assert!(elise.combos.iter().any(|n| n.combo_id == 164 && n.needs_verification), "interaction a verifier");
    // Sett + Quantum Computing : augment absent du patch, combo masque.
    let ds = dataset();
    let sett = ds.combos.iter().find(|c| c.combo_id == 47).unwrap();
    assert!(!sett.in_pool);
}
