//! Cycle de vie de l'assistant Mayhem pendant une partie `KIWI`.
//!
//! - Lecture : session courte (une lecture toutes les ~800 ms) declenchee par le raccourci
//!   (assistance demandee) ou apres une montee de niveau si la lecture automatique est active
//!   et le mode Eco desactive. La presence des cartes est verifiee a l'ecran.
//! - Un seul traitement a la fois ; image inchangee = pas de nouvel OCR ; moteur OCR cree pour
//!   la session puis libere.
//! - Les notes sont calculees dans le meme fil que l'observation et emises avec son numero de
//!   version : une observation plus ancienne ne peut pas reecrire les badges.

use super::data;
use super::screen::{self, GameRect, Reader};
use crate::client::model::LiveSnapshot;
use crate::error::AppResult;
use crate::persistence::settings;
use crate::state::AppState;
use nex_mayhem::engine::{Context, Rating, best_affinity, rate};
use nex_mayhem::matching::{CardTitle, NameIndex, find_titles};
use nex_mayhem::observe::{HideReason, Meta, Observation, Source, Tracker, Update};
use nex_mayhem::rules::Orientation;
use nex_mayhem::{ChampionProfile, MayhemCatalog, Rarity};
use nex_mayhem::provider::{CardContext, card_context};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Duree d'une session de lecture sans cartes visibles.
pub const SESSION_HOTKEY: Duration = Duration::from_secs(20);
const SESSION_LEVEL_UP: Duration = Duration::from_secs(12);
/// Prolongation tant que des cartes sont visibles, et duree maximale d'une session.
const SESSION_EXTEND: Duration = Duration::from_secs(6);
const SESSION_MAX: Duration = Duration::from_secs(120);
const READ_INTERVAL: Duration = Duration::from_millis(800);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardView {
    pub slot: u8,
    pub key: Option<String>,
    pub name: Option<String>,
    pub rarity: Option<Rarity>,
    pub text: String,
    pub confidence: Option<nex_mayhem::Confidence>,
    /// Rectangle du titre en fractions de la zone client du jeu (absent en saisie manuelle).
    pub rect: Option<[f32; 4]>,
}

/// Evenement `mayhem://cards` : ce que l'overlay affiche (ou `null` pour tout masquer).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardsEvent {
    pub version: u64,
    pub phase: u32,
    pub source: Source,
    pub demo: bool,
    /// Zone client du jeu en pixels ecran (pour placer les badges).
    pub game: Option<GameRect>,
    pub champion: Option<String>,
    pub cards: Vec<CardView>,
    pub ratings: Vec<Rating>,
    pub best: Option<usize>,
    pub rules_version: String,
    /// Contexte par carte (popularite, combos) ; informatif.
    pub context: Vec<CardContext>,
    pub at: i64,
    /// Temps de lecture (capture + OCR) de cette observation, en ms.
    pub read_ms: Option<u32>,
}

#[derive(Default)]
struct Inner {
    catalog: Option<Arc<MayhemCatalog>>,
    index: Option<Arc<NameIndex>>,
    tracker: Tracker,
    game_id: String,
    confirmed: Vec<String>,
    last_level: u32,
    champion: Option<String>,
    profile: Option<ChampionProfile>,
    items: Vec<u32>,
    item_tags: Option<Arc<HashMap<u32, Vec<String>>>>,
    /// Donnees publiques (popularite, combos) : instantane coherent pendant une phase.
    dataset: Option<Arc<nex_mayhem::provider::Dataset>>,
    locale: String,
    last_fp: u64,
    last_titles: Vec<CardTitle>,
    current: Option<CardsEvent>,
    demo: bool,
}

#[derive(Default)]
pub struct MayhemService {
    inner: Mutex<Inner>,
    reading: AtomicBool,
    session_until: AtomicI64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn orientation(s: &str) -> Option<Orientation> {
    match s {
        "degats" => Some(Orientation::Degats),
        "resistance" => Some(Orientation::Resistance),
        "soutien" => Some(Orientation::Soutien),
        "mobilite" => Some(Orientation::Mobilite),
        _ => None,
    }
}

impl MayhemService {
    pub fn current(&self) -> Option<CardsEvent> {
        self.inner.lock().ok().and_then(|i| i.current.clone())
    }

    pub fn confirmed(&self) -> Vec<String> {
        self.inner.lock().map(|i| i.confirmed.clone()).unwrap_or_default()
    }

    fn emit(app: &AppHandle, ev: Option<&CardsEvent>) {
        let _ = app.emit("mayhem://cards", ev);
    }

    /// Notes de l'observation courante (regles de production ou de demonstration).
    fn build_event(&self, app: &AppHandle, inner: &Inner, obs: &Observation, game: Option<GameRect>, read_ms: Option<u32>) -> AppResult<CardsEvent> {
        let st = app.state::<AppState>();
        let rules = if obs.source == Source::Demo { data::demo_rules()? } else { data::production_rules(&st.db)? };
        let prefs = st.db.with(settings::load)?;
        let items = match &inner.item_tags {
            Some(tags) => {
                let names: Vec<&str> = inner.items.iter().filter_map(|id| tags.get(id)).flatten().map(String::as_str).collect();
                nex_mayhem::profile::from_item_tags(&names)
            }
            None => Default::default(),
        };
        let ctx = Context { champion: inner.profile.as_ref(), items, confirmed: obs.confirmed.clone(), orientation: orientation(&prefs.mayhem_orientation) };
        let keys: Vec<Option<&str>> = obs.cards.iter().map(|c| c.key.as_deref()).collect();
        let catalog = inner.catalog.as_deref();
        let ratings = rate(&rules, catalog, &ctx, &keys);
        let best = best_affinity(&ratings);
        let cards = obs
            .cards
            .iter()
            .map(|c| {
                let a = c.key.as_deref().and_then(|k| catalog.and_then(|cat| cat.get(k)));
                CardView {
                    slot: c.slot,
                    key: c.key.clone(),
                    name: a.map(|a| if prefs.language == "en" { a.name_en.clone() } else { a.name_fr.clone() }),
                    rarity: a.map(|a| a.rarity),
                    text: c.text.chars().take(80).collect(),
                    confidence: c.confidence,
                    rect: c.rect,
                }
            })
            .collect();
        Ok(CardsEvent {
            version: obs.version,
            phase: obs.phase,
            source: obs.source,
            demo: obs.source == Source::Demo,
            game,
            champion: inner.champion.clone(),
            cards,
            ratings,
            best,
            rules_version: rules.version,
            context: obs.cards.iter().map(|c| card_context(inner.dataset.as_deref(), inner.champion.as_deref(), c.key.as_deref(), &obs.confirmed)).collect(),
            at: obs.at_ms,
            read_ms,
        })
    }

    fn meta(inner: &Inner) -> Meta {
        Meta {
            game_id: inner.game_id.clone(),
            champion: inner.champion.clone(),
            confirmed: inner.confirmed.clone(),
            patch: inner.catalog.as_ref().map(|c| c.patch.clone()).unwrap_or_default(),
        }
    }

    /// Applique une mise a jour du suivi : notes + emission, ou masquage.
    fn apply(&self, app: &AppHandle, inner: &mut Inner, update: Update, game: Option<GameRect>, read_ms: Option<u32>) {
        match update {
            Update::Show(obs) => {
                if !inner.tracker.accepts(obs.version) {
                    return;
                }
                let t0 = Instant::now();
                match self.build_event(app, inner, &obs, game, read_ms) {
                    Ok(ev) => {
                        // Diagnostic (sortie d'erreur) : aucun nom de joueur, seulement les durees.
                        eprintln!(
                            "[mayhem] observation v{} phase {} : {} carte(s), lecture {} ms, notes {} us",
                            ev.version,
                            ev.phase,
                            ev.cards.len(),
                            read_ms.map_or("-".into(), |m| m.to_string()),
                            t0.elapsed().as_micros()
                        );
                        inner.current = Some(ev.clone());
                        Self::emit(app, Some(&ev));
                    }
                    Err(e) => eprintln!("[mayhem] notes impossibles : {e}"),
                }
            }
            Update::Hide(reason) => {
                eprintln!("[mayhem] badges retires ({reason:?})");
                inner.current = None;
                inner.last_titles.clear();
                Self::emit(app, None);
            }
            Update::Unchanged => {}
        }
    }

    /// Nouvel instantane de partie (toutes les 2 s) : contexte, partie, declenchement.
    pub fn on_snapshot(self: &Arc<Self>, app: &AppHandle, snap: &LiveSnapshot) {
        if snap.game_mode != "KIWI" {
            return;
        }
        let me = snap.players.iter().find(|p| p.is_active);
        let mut start = None;
        let mut prefetch = None;
        if let Ok(mut inner) = self.inner.lock() {
            if inner.game_id.is_empty() {
                // Nouvelle partie (identifiant local) : rien de la precedente n'est conserve.
                let upd = inner.tracker.on_lost(HideReason::GameChanged);
                self.apply(app, &mut inner, upd, None, None);
                inner.game_id = format!("kiwi-{}", now_ms());
                inner.confirmed.clear();
                inner.last_level = 0;
                inner.profile = None;
                inner.champion = None;
                inner.demo = false;
            }
            if let Some(me) = me {
                let champ = Some(me.champion_key.clone()).filter(|k| !k.is_empty());
                if champ != inner.champion {
                    inner.champion = champ.clone();
                    inner.profile = None;
                    prefetch = champ;
                }
                inner.items = me.items.clone();
                if snap.active_level > inner.last_level {
                    if inner.last_level > 0 {
                        start = Some(SESSION_LEVEL_UP);
                    }
                    inner.last_level = snap.active_level;
                }
            }
            if inner.catalog.is_none() || inner.item_tags.is_none() {
                prefetch = prefetch.or_else(|| inner.champion.clone()).or(Some(String::new()));
            }
        }
        if let Some(champ) = prefetch {
            let (svc, app2) = (self.clone(), app.clone());
            tauri::async_runtime::spawn(async move { svc.prefetch(&app2, &champ).await });
        }
        if let Some(d) = start {
            let st = app.state::<AppState>();
            let auto = st.db.with(settings::load).map(|s| s.mayhem_auto && !s.eco_mode).unwrap_or(false);
            if auto {
                self.start_session(app, d);
            }
        }
    }

    /// Catalogue, profil du champion, etiquettes d'objets et langue du client (en arriere-plan).
    async fn prefetch(&self, app: &AppHandle, champion: &str) {
        let st = app.state::<AppState>();
        let version = crate::adapters::ddragon::latest_version(&st.db, &st.http).await.map(|v| v.version).unwrap_or_default();
        let catalog = data::catalog(&st.db, &st.http).await.ok();
        let dataset = match &catalog {
            Some(c) => data::dataset(&st.db, &st.http, c).await.ok(),
            None => None,
        };
        let profile = if champion.is_empty() || version.is_empty() { None } else { data::profile(&st.db, &st.http, &version, champion).await.ok() };
        let tags = if version.is_empty() { None } else { data::item_tags(&st.db, &st.http, &version).await.ok() };
        let locale = match app.state::<crate::client::service::ClientService>().lcu() {
            Some(lcu) => lcu.get::<serde_json::Value>(crate::adapters::lcu::paths::REGION).await.ok().and_then(|v| v.get("locale").and_then(|l| l.as_str()).map(|l| l.replace('_', "-"))),
            None => None,
        };
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(c) = catalog {
                inner.index = Some(Arc::new(NameIndex::new(&c)));
                inner.catalog = Some(Arc::new(c));
            }
            if profile.as_ref().is_some_and(|p| Some(&p.key) == inner.champion.as_ref()) {
                inner.profile = profile;
            }
            if let Some(t) = tags {
                inner.item_tags = Some(Arc::new(t));
            }
            if let Some(d) = dataset {
                inner.dataset = Some(Arc::new(d));
            }
            if let Some(l) = locale {
                inner.locale = l;
            }
        }
    }

    /// Fin de partie ou perte du client : masquage et liberation.
    pub fn on_leave(&self, app: &AppHandle) {
        self.session_until.store(0, Ordering::SeqCst);
        if let Ok(mut inner) = self.inner.lock() {
            let upd = inner.tracker.on_lost(HideReason::GameChanged);
            self.apply(app, &mut inner, upd, None, None);
            inner.last_titles.clear();
            inner.last_fp = 0;
            inner.demo = false;
            inner.game_id.clear();
            inner.confirmed.clear();
        }
    }

    /// Demarre (ou prolonge) une session de lecture. Un seul fil de lecture a la fois.
    pub fn start_session(self: &Arc<Self>, app: &AppHandle, duration: Duration) {
        let until = now_ms() + duration.as_millis() as i64;
        self.session_until.fetch_max(until, Ordering::SeqCst);
        if self.reading.swap(true, Ordering::SeqCst) {
            return;
        }
        let (svc, app) = (self.clone(), app.clone());
        std::thread::spawn(move || {
            svc.run(&app);
            svc.reading.store(false, Ordering::SeqCst);
        });
    }

    fn run(&self, app: &AppHandle) {
        let started = Instant::now();
        // Catalogue charge a la demande (lecture declenchee hors d'une partie deja suivie).
        if self.inner.lock().map(|i| i.index.is_none()).unwrap_or(false) {
            let st = app.state::<AppState>();
            match tauri::async_runtime::block_on(data::catalog(&st.db, &st.http)) {
                Ok(c) => {
                    if let Ok(mut inner) = self.inner.lock() {
                        inner.index = Some(Arc::new(NameIndex::new(&c)));
                        inner.catalog = Some(Arc::new(c));
                    }
                }
                Err(e) => {
                    eprintln!("[mayhem] catalogue indisponible : {e}");
                    return;
                }
            }
        }
        let lang = self.inner.lock().map(|i| i.locale.clone()).unwrap_or_default();
        let reader = match Reader::new(if lang.is_empty() { "en-US" } else { &lang }) {
            Ok(r) => {
                eprintln!("[mayhem] session de lecture (OCR {})", r.lang);
                r
            }
            Err(e) => {
                eprintln!("[mayhem] {e}");
                return;
            }
        };
        while now_ms() < self.session_until.load(Ordering::SeqCst) && started.elapsed() < SESSION_MAX {
            let tick = Instant::now();
            self.step(app, &reader);
            std::thread::sleep(READ_INTERVAL.saturating_sub(tick.elapsed()));
        }
        // Fin de session : le moteur OCR est libere avec `reader`.
    }

    fn step(&self, app: &AppHandle, reader: &Reader) {
        let Some((_, game)) = screen::foreground_game() else {
            // Jeu masque ou en arriere-plan : aucun badge perime.
            if let Ok(mut inner) = self.inner.lock() {
                if inner.current.as_ref().is_some_and(|c| c.source == Source::ScreenReading) {
                    let upd = inner.tracker.on_lost(HideReason::FocusLost);
                    self.apply(app, &mut inner, upd, None, None);
                }
            }
            return;
        };
        let t0 = Instant::now();
        let Ok((px, w, h, ox, oy)) = screen::grab(game) else { return };
        let fp = screen::fingerprint(&px, w, h);
        let (index, same) = match self.inner.lock() {
            Ok(i) => (i.index.clone(), i.last_fp == fp),
            Err(_) => return,
        };
        let Some(index) = index else { return };
        let titles = if same {
            self.inner.lock().map(|i| i.last_titles.clone()).unwrap_or_default()
        } else {
            match reader.read(&px, w, h, ox, oy, game) {
                Ok(lines) => find_titles(&index, &lines),
                Err(e) => {
                    eprintln!("[mayhem] {e}");
                    return;
                }
            }
        };
        let read_ms = (!same).then(|| t0.elapsed().as_millis() as u32);
        drop(px);
        let Ok(mut inner) = self.inner.lock() else { return };
        inner.last_fp = fp;
        inner.last_titles = titles.clone();
        let meta = Self::meta(&inner);
        let now = now_ms();
        let upd = inner.tracker.on_read(&meta, &titles, now);
        if titles.len() >= 2 {
            self.session_until.fetch_max(now + SESSION_EXTEND.as_millis() as i64, Ordering::SeqCst);
        }
        self.apply(app, &mut inner, upd, Some(game), read_ms);
        let upd = inner.tracker.tick(now);
        self.apply(app, &mut inner, upd, None, None);
    }

    /// Saisie manuelle (depannage) ou apercu de demonstration.
    pub fn manual(&self, app: &AppHandle, keys: &[Option<String>], demo: bool) -> AppResult<Option<CardsEvent>> {
        let mut inner = self.inner.lock().map_err(|_| crate::error::AppError::Unavailable("etat Mayhem indisponible".into()))?;
        let meta = Self::meta(&inner);
        let source = if demo { Source::Demo } else { Source::Manual };
        let upd = inner.tracker.on_manual(&meta, keys, source, now_ms());
        inner.demo = demo;
        self.apply(app, &mut inner, upd, screen::foreground_game().map(|(_, g)| g), None);
        Ok(inner.current.clone())
    }

    pub fn clear(&self, app: &AppHandle) {
        if let Ok(mut inner) = self.inner.lock() {
            let upd = inner.tracker.on_lost(HideReason::Cleared);
            self.apply(app, &mut inner, upd, None, None);
            inner.demo = false;
        }
    }

    /// Confirmation explicite d'un augment choisi (ou annulation) : recalcule les notes.
    pub fn confirm(&self, app: &AppHandle, key: &str, chosen: bool) -> Vec<String> {
        let Ok(mut inner) = self.inner.lock() else { return vec![] };
        if chosen {
            if !inner.confirmed.iter().any(|k| k == key) && inner.confirmed.len() < 12 {
                inner.confirmed.push(key.to_string());
            }
        } else {
            inner.confirmed.retain(|k| k != key);
        }
        // Les notes affichees changent de contexte : nouvelle version de l'observation.
        if let Some(cur) = inner.current.clone() {
            let keys: Vec<Option<String>> = cur.cards.iter().map(|c| c.key.clone()).collect();
            let meta = Self::meta(&inner);
            if cur.source == Source::ScreenReading {
                let titles = inner.last_titles.clone();
                let upd = inner.tracker.on_read(&meta, &titles, now_ms());
                self.apply(app, &mut inner, upd, cur.game, None);
            } else {
                let upd = inner.tracker.on_manual(&meta, &keys, cur.source, now_ms());
                self.apply(app, &mut inner, upd, cur.game, None);
            }
        }
        inner.confirmed.clone()
    }
}
