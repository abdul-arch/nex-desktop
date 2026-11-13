//! Assistant ARAM Mayhem (mode `KIWI`).
//!
//! Separation des responsabilites :
//! - [`catalog`] : augments du mode (identifiant, noms, rarete du jeu, icone, provenance) ;
//! - [`rules`] : regles de notation versionnees (donnees validees, jamais executees) ;
//! - [`profile`] : mecaniques d'un champion (heuristique Data Dragon ou edition) ;
//! - [`engine`] : notation deterministe base + bonus/malus plafonnes -> tier S+ a D ;
//! - [`matching`] : identification d'une carte a partir d'un texte lu (OCR) ;
//! - [`observe`] : observations versionnees, relances, expiration.
//!
//! La rarete du jeu (Argent/Or/Prismatique), la note NEX, la confiance d'identification et le
//! niveau de validation des conseils sont des notions distinctes et ne sont jamais deduites
//! l'une de l'autre.

pub mod catalog;
pub mod engine;
pub mod matching;
pub mod observe;
pub mod profile;
pub mod provider;
pub mod rules;

pub use catalog::{Augment, MayhemCatalog, Rarity};
pub use engine::{Context, Rating, RatingStatus, best_affinity, rate};
pub use matching::{Confidence, Identified, identify};
pub use profile::{ChampionProfile, Mechanic, ProfileSource};
pub use rules::{AugmentRule, Orientation, RuleSet, Tier, Validation};
