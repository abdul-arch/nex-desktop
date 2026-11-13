//! Observations versionnees des cartes proposees et cycle de vie de l'affichage.
//!
//! - Une phase de choix commence quand au moins deux titres d'augments sont lus a l'ecran
//!   (presence verifiee, pas deduite d'une liste de niveaux).
//! - Toute modification des cartes (relance d'une carte, nombre different) cree une nouvelle
//!   version : les notes de l'ancienne version sont invalidees, et une reponse tardive portant
//!   un ancien numero de version est refusee ([`Tracker::accepts`]).
//! - La disparition des cartes masque les badges mais ne confirme aucun choix.
//! - Expiration selon la fiabilite de la source ; perte de focus ou changement de partie :
//!   masquage immediat.

use crate::matching::{CardTitle, Confidence};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// Lecture locale de l'ecran (assistance, declenchee par raccourci ou apres une montee de niveau).
    ScreenReading,
    /// Saisie manuelle du joueur (depannage).
    Manual,
    /// Donnees de demonstration (configuration).
    Demo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    /// Position gauche -> droite, a partir de 0.
    pub slot: u8,
    pub key: Option<String>,
    /// Texte lu (ou saisi).
    pub text: String,
    pub confidence: Option<Confidence>,
    /// Rectangle du titre, en fractions de la fenetre du jeu (absent en mode manuel).
    pub rect: Option<[f32; 4]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub game_id: String,
    /// Numero de la phase de choix dans la partie.
    pub phase: u32,
    /// Version de l'observation (strictement croissante dans la session).
    pub version: u64,
    pub champion: Option<String>,
    pub cards: Vec<Card>,
    pub confirmed: Vec<String>,
    pub patch: String,
    pub source: Source,
    pub at_ms: i64,
    /// Confiance minimale des cartes (`None` si une carte n'est pas identifiee).
    pub confidence: Option<Confidence>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HideReason {
    CardsGone,
    Expired,
    FocusLost,
    GameChanged,
    Cleared,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Update {
    Show(Observation),
    Hide(HideReason),
    Unchanged,
}

/// Duree de validite d'une observation sans nouvelle lecture qui la confirme.
pub fn ttl_ms(source: Source) -> i64 {
    match source {
        Source::ScreenReading => 5_000,
        Source::Manual => 10 * 60_000,
        Source::Demo => 30_000,
    }
}

/// Lectures consecutives sans carte avant de considerer que la phase est terminee.
pub const MISSES_TO_HIDE: u32 = 2;

#[derive(Debug, Default)]
pub struct Tracker {
    game_id: String,
    phase: u32,
    version: u64,
    current: Option<Observation>,
    last_seen_ms: i64,
    misses: u32,
}

/// Contexte fourni par l'appelant pour chaque nouvelle observation.
#[derive(Debug, Clone, Default)]
pub struct Meta {
    pub game_id: String,
    pub champion: Option<String>,
    pub confirmed: Vec<String>,
    pub patch: String,
}

fn min_confidence(cards: &[Card]) -> Option<Confidence> {
    let rank = |c: Confidence| match c {
        Confidence::Exact => 2,
        Confidence::Approx => 1,
        Confidence::Ambiguous => 0,
    };
    cards.iter().map(|c| c.confidence).try_fold(Confidence::Exact, |acc, c| {
        let c = c?;
        Some(if rank(c) < rank(acc) { c } else { acc })
    })
}

impl Tracker {
    pub fn current(&self) -> Option<&Observation> {
        self.current.as_ref()
    }

    /// Une reponse asynchrone (notes calculees) ne s'applique qu'a la version courante.
    pub fn accepts(&self, version: u64) -> bool {
        self.current.as_ref().is_some_and(|o| o.version == version)
    }

    fn reset_game(&mut self, game_id: &str) {
        if self.game_id != game_id {
            self.game_id = game_id.to_string();
            self.phase = 0;
        }
    }

    fn publish(&mut self, meta: &Meta, cards: Vec<Card>, source: Source, now: i64, new_phase: bool) -> Update {
        if new_phase {
            self.phase += 1;
        }
        self.version += 1;
        let obs = Observation {
            game_id: meta.game_id.clone(),
            phase: self.phase,
            version: self.version,
            champion: meta.champion.clone(),
            confidence: min_confidence(&cards),
            cards,
            confirmed: meta.confirmed.clone(),
            patch: meta.patch.clone(),
            source,
            at_ms: now,
        };
        self.current = Some(obs.clone());
        self.last_seen_ms = now;
        self.misses = 0;
        Update::Show(obs)
    }

    /// Resultat d'une lecture d'ecran : titres trouves (tries de gauche a droite).
    pub fn on_read(&mut self, meta: &Meta, titles: &[CardTitle], now: i64) -> Update {
        self.reset_game(&meta.game_id);
        if self.current.as_ref().is_some_and(|o| o.game_id != meta.game_id) {
            self.current = None;
        }
        if titles.len() < 2 {
            // Pas de phase de choix visible.
            if self.current.as_ref().is_some_and(|o| o.source == Source::ScreenReading) {
                self.misses += 1;
                if self.misses >= MISSES_TO_HIDE {
                    self.current = None;
                    return Update::Hide(HideReason::CardsGone);
                }
            }
            return Update::Unchanged;
        }
        let cards: Vec<Card> = titles
            .iter()
            .enumerate()
            .map(|(i, t)| Card {
                slot: i as u8,
                key: (t.identified.confidence != Confidence::Ambiguous).then(|| t.identified.key.clone()),
                text: t.text.clone(),
                confidence: Some(t.identified.confidence),
                rect: Some([t.x, t.y, t.w, t.h]),
            })
            .collect();
        match &self.current {
            Some(o) if o.source == Source::ScreenReading && same_cards(&o.cards, &cards) && o.champion == meta.champion && o.confirmed == meta.confirmed => {
                self.last_seen_ms = now;
                self.misses = 0;
                Update::Unchanged
            }
            // Relance ou changement de contexte pendant la meme phase : nouvelle version.
            Some(o) if o.source == Source::ScreenReading => {
                let _ = o;
                self.publish(meta, cards, Source::ScreenReading, now, false)
            }
            _ => self.publish(meta, cards, Source::ScreenReading, now, true),
        }
    }

    /// Saisie manuelle (ou demonstration) : remplace l'observation courante.
    pub fn on_manual(&mut self, meta: &Meta, keys: &[Option<String>], source: Source, now: i64) -> Update {
        self.reset_game(&meta.game_id);
        let cards = keys
            .iter()
            .enumerate()
            .map(|(i, k)| Card { slot: i as u8, key: k.clone(), text: k.clone().unwrap_or_default(), confidence: k.as_ref().map(|_| Confidence::Exact), rect: None })
            .collect();
        let new_phase = self.current.as_ref().is_none_or(|o| o.source != source);
        self.publish(meta, cards, source, now, new_phase)
    }

    /// Masquage immediat (perte de focus, fin ou changement de partie, effacement).
    pub fn on_lost(&mut self, reason: HideReason) -> Update {
        if self.current.take().is_some() { Update::Hide(reason) } else { Update::Unchanged }
    }

    /// Expiration selon la fiabilite de la source.
    pub fn tick(&mut self, now: i64) -> Update {
        match &self.current {
            Some(o) if now - self.last_seen_ms > ttl_ms(o.source) => {
                self.current = None;
                Update::Hide(HideReason::Expired)
            }
            _ => Update::Unchanged,
        }
    }
}

fn same_cards(a: &[Card], b: &[Card]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.key == y.key && x.text == y.text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::Identified;

    fn title(key: &str, x: f32, conf: Confidence) -> CardTitle {
        CardTitle { text: key.into(), identified: Identified { key: key.into(), confidence: conf, similarity: 1.0 }, x, y: 0.4, w: 0.08, h: 0.02 }
    }
    fn meta(game: &str) -> Meta {
        Meta { game_id: game.into(), champion: Some("Ahri".into()), confirmed: vec![], patch: "16.22".into() }
    }

    #[test]
    fn reroll_creates_new_version_and_rejects_late_answers() {
        let mut t = Tracker::default();
        let m = meta("g1");
        let three = [title("A", 0.3, Confidence::Exact), title("B", 0.45, Confidence::Exact), title("C", 0.6, Confidence::Exact)];
        let Update::Show(o1) = t.on_read(&m, &three, 0) else { panic!() };
        assert_eq!((o1.phase, o1.version), (1, 1));
        assert_eq!(t.on_read(&m, &three, 500), Update::Unchanged);
        // Relance de la carte du milieu.
        let rerolled = [title("A", 0.3, Confidence::Exact), title("Z", 0.45, Confidence::Exact), title("C", 0.6, Confidence::Exact)];
        let Update::Show(o2) = t.on_read(&m, &rerolled, 1000) else { panic!() };
        assert_eq!((o2.phase, o2.version), (1, 2), "meme phase, nouvelle version");
        assert!(!t.accepts(1), "une reponse tardive de la version 1 est refusee");
        assert!(t.accepts(2));
    }

    #[test]
    fn disappearance_hides_but_confirms_nothing() {
        let mut t = Tracker::default();
        let m = meta("g1");
        let two = [title("A", 0.3, Confidence::Exact), title("B", 0.6, Confidence::Approx)];
        let Update::Show(o) = t.on_read(&m, &two, 0) else { panic!() };
        assert_eq!(o.confidence, Some(Confidence::Approx));
        assert_eq!(t.on_read(&m, &[], 1000), Update::Unchanged, "une lecture manquee ne suffit pas");
        assert_eq!(t.on_read(&m, &[], 2000), Update::Hide(HideReason::CardsGone));
        assert!(t.current().is_none());
        // Phase suivante : numero de phase incremente, aucun augment ajoute aux confirmes.
        let Update::Show(o2) = t.on_read(&m, &two, 60_000) else { panic!() };
        assert_eq!(o2.phase, 2);
        assert!(o2.confirmed.is_empty());
    }

    #[test]
    fn expiry_focus_and_game_change() {
        let mut t = Tracker::default();
        let two = [title("A", 0.3, Confidence::Exact), title("B", 0.6, Confidence::Exact)];
        t.on_read(&meta("g1"), &two, 0);
        assert_eq!(t.tick(4000), Update::Unchanged);
        assert_eq!(t.tick(5001), Update::Hide(HideReason::Expired));
        t.on_read(&meta("g1"), &two, 6000);
        assert_eq!(t.on_lost(HideReason::FocusLost), Update::Hide(HideReason::FocusLost));
        t.on_read(&meta("g1"), &two, 7000);
        let Update::Show(o) = t.on_read(&meta("g2"), &two, 8000) else { panic!() };
        assert_eq!((o.game_id.as_str(), o.phase), ("g2", 1), "nouvelle partie : rien de l'ancienne");
    }

    #[test]
    fn ambiguous_card_has_no_key_and_single_title_is_not_a_phase() {
        let mut t = Tracker::default();
        let m = meta("g1");
        assert_eq!(t.on_read(&m, &[title("A", 0.3, Confidence::Exact)], 0), Update::Unchanged);
        let Update::Show(o) = t.on_read(&m, &[title("A", 0.3, Confidence::Exact), title("B", 0.6, Confidence::Ambiguous)], 0) else { panic!() };
        assert!(o.cards[1].key.is_none());
        assert_eq!(o.confidence, Some(Confidence::Ambiguous));
    }

    #[test]
    fn manual_mode_is_distinct_and_long_lived() {
        let mut t = Tracker::default();
        let Update::Show(o) = t.on_manual(&meta("g1"), &[Some("A".into()), None, Some("C".into())], Source::Manual, 0) else { panic!() };
        assert_eq!(o.source, Source::Manual);
        assert_eq!(o.confidence, None, "une carte non saisie");
        assert_eq!(t.tick(9 * 60_000), Update::Unchanged);
        // Une lecture vide n'efface pas une saisie manuelle.
        assert_eq!(t.on_read(&meta("g1"), &[], 1000), Update::Unchanged);
    }
}
