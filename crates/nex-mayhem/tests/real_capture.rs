//! Validation sur une lecture reelle : partie ARAM Mayhem du 8 novembre 2026 (voir la
//! provenance dans le fichier). Valide l'identification et le placement a partir de textes
//! reellement lus a l'ecran ; ne valide pas la capture elle-meme ni d'autres resolutions.

use nex_mayhem::matching::{Confidence, NameIndex, TextLine, find_titles};
use nex_mayhem::{MayhemCatalog, observe};
use serde_json::Value;

fn load(name: &str) -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name);
    let text = std::fs::read_to_string(p).unwrap();
    serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap()
}

fn catalog() -> MayhemCatalog {
    serde_json::from_value(load("catalog-kiwi-16.22.json")).unwrap()
}

fn lines(v: &Value) -> Vec<TextLine> {
    serde_json::from_value(v["lines"].clone()).unwrap()
}

#[test]
fn identifies_the_three_real_cards_in_order() {
    let cat = catalog();
    assert_eq!(cat.augments.len(), 242);
    let capture = load("ocr-2026-11-08-en-1440p.json");
    let idx = NameIndex::new(&cat);
    let titles = find_titles(&idx, &lines(&capture));
    let keys: Vec<&str> = titles.iter().map(|t| t.identified.key.as_str()).collect();
    let expected: Vec<String> = serde_json::from_value(capture["expected"].clone()).unwrap();
    assert_eq!(keys, expected);
    // Deux titres lus exactement ; « 0k Boomerang » (zero au lieu de O) reconnu par approximation.
    assert_eq!(titles[0].identified.confidence, Confidence::Exact);
    assert_eq!(titles[1].identified.confidence, Confidence::Exact);
    assert_eq!(titles[2].identified.confidence, Confidence::Approx);
    // Positions : centres des titres a moins de 1 % des centres mesures sur la capture.
    let centers: Vec<f32> = serde_json::from_value(capture["cardTitleCentersX"].clone()).unwrap();
    for (t, c) in titles.iter().zip(centers) {
        assert!((t.x + t.w / 2.0 - c).abs() < 0.01, "{} : {}", t.text, t.x + t.w / 2.0);
    }
}

#[test]
fn other_overlay_lists_do_not_create_cards() {
    // Liste verticale de noms d'augments affichee par une autre application (vue sur la meme
    // capture, a gauche de l'ecran) : meme si elle etait dans la zone lue, pas de cartes.
    let idx = NameIndex::new(&catalog());
    let l = |text: &str, y: f32| TextLine { text: text.into(), x: 0.06, y, w: 0.05, h: 0.008 };
    let list = vec![l("Ça boomerang ?", 0.13), l("Toujours là", 0.147), l("Brasier", 0.164)];
    assert!(find_titles(&idx, &list).is_empty());
}

#[test]
fn real_lines_start_a_choice_phase() {
    let idx = NameIndex::new(&catalog());
    let titles = find_titles(&idx, &lines(&load("ocr-2026-11-08-en-1440p.json")));
    let mut tracker = observe::Tracker::default();
    let meta = observe::Meta { game_id: "reelle".into(), champion: Some("Ezreal".into()), confirmed: vec![], patch: "16.22".into() };
    let observe::Update::Show(o) = tracker.on_read(&meta, &titles, 0) else { panic!("phase non detectee") };
    assert_eq!(o.cards.len(), 3);
    assert!(o.cards.iter().all(|c| c.key.is_some()));
    assert_eq!(o.confidence, Some(Confidence::Approx));
}
