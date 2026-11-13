//! Orchestration de la capture : demarrage explicite (mode Capture), tampon de replay borne,
//! clips (manuels, raccourci, automatiques), enregistrement de partie complete, quota, reprise
//! apres interruption. Aucun fichier n'est partage : tout reste local.

use super::engine::{EngineConfig, Flags, Recorder, Shared};
use super::{hw, remux, segments};
use crate::client::model::Highlight;
use crate::error::{AppError, AppResult};
use crate::persistence::recordings::{self, Marker, NewRecording, Recording};
use crate::persistence::settings;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use windows_capture::capture::{CaptureControl, GraphicsCaptureApiHandler};
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings,
    SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

pub const GAME_WINDOW: &str = "League of Legends (TM) Client";
pub const FPS: u32 = 30;
pub const SEGMENT_MS: i64 = 10_000;
const MIN_FREE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Debug)]
pub enum Source {
    GameWindow,
    Window(String),
    PrimaryMonitor,
}

#[derive(Clone, Debug, Default)]
pub struct GameInfo {
    pub champion_key: Option<String>,
    pub game_mode: Option<String>,
    /// Temps de jeu (s) au demarrage de la capture : relie temps de jeu et video.
    pub game_time_at_start: Option<f64>,
}

struct Session {
    control: Option<CaptureControl<Recorder, String>>,
    shared: Arc<Shared>,
    dir: PathBuf,
    source: String,
    started_ms: i64,
    keep_all: bool,
    game: GameInfo,
    highlights: Vec<Highlight>,
    kda: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub active: bool,
    pub source: Option<String>,
    pub started_at: Option<i64>,
    pub keep_all: bool,
    pub frames_sent: u64,
    pub frames_dropped: u64,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub buffered_seconds: u32,
    pub buffered_mib: u32,
    pub encoders: Vec<String>,
    pub error: Option<String>,
    pub finalizing: bool,
}

#[derive(Default)]
pub struct CaptureService {
    session: Mutex<Option<Session>>,
    last_error: Mutex<Option<String>>,
    finalizing: AtomicBool,
    encoders: Mutex<Option<Vec<String>>>,
    /// Nombre de moments « clip_worthy » deja traites pour la partie en cours.
    auto_clipped: Mutex<usize>,
}

fn now_ms() -> i64 {
    crate::persistence::now_secs() * 1000 + (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_millis() as i64).unwrap_or(0))
}

pub fn base_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let videos = app.path().video_dir().map_err(|e| AppError::Unavailable(format!("dossier Vidéos introuvable : {e}")))?;
    Ok(videos.join("NEX"))
}

fn free_space(path: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list().ok()?;
    disks
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

fn settings_of(app: &AppHandle) -> settings::Settings {
    app.try_state::<AppState>().and_then(|s| s.db.with(settings::load).ok()).unwrap_or_default()
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit("recordings://changed", ());
}

impl CaptureService {
    pub fn encoders(&self) -> Vec<String> {
        let mut g = self.encoders.lock().unwrap_or_else(|p| p.into_inner());
        g.get_or_insert_with(hw::hardware_h264_encoders).clone()
    }

    /// Diagnostic : (index, debut ms, duree ms, octets) des segments du tampon.
    pub fn buffer_summary(&self) -> Vec<(u64, i64, i64, u64)> {
        self.session
            .lock()
            .ok()
            .and_then(|s| s.as_ref().map(|x| x.shared.segments.lock().map(|b| b.iter().map(|g| (g.index, g.started_ms, g.duration_ms, g.bytes)).collect()).unwrap_or_default()))
            .unwrap_or_default()
    }

    pub fn is_active(&self) -> bool {
        self.session.lock().map(|s| s.is_some()).unwrap_or(false)
    }

    pub fn status(&self) -> CaptureStatus {
        let s = self.session.lock().unwrap_or_else(|p| p.into_inner());
        let mut st = CaptureStatus {
            encoders: self.encoders(),
            finalizing: self.finalizing.load(Ordering::SeqCst),
            error: self.last_error.lock().ok().and_then(|e| e.clone()),
            fps: FPS,
            ..Default::default()
        };
        if let Some(sess) = s.as_ref() {
            let buf = sess.shared.segments.lock().map(|b| b.clone()).unwrap_or_default();
            st.active = true;
            st.source = Some(sess.source.clone());
            st.started_at = Some(sess.started_ms);
            st.keep_all = sess.keep_all;
            st.frames_sent = sess.shared.frames_sent.load(Ordering::Relaxed);
            st.frames_dropped = sess.shared.frames_dropped.load(Ordering::Relaxed);
            st.width = sess.shared.width.load(Ordering::Relaxed);
            st.height = sess.shared.height.load(Ordering::Relaxed);
            st.buffered_seconds = (buf.iter().map(|x| x.duration_ms).sum::<i64>() / 1000) as u32;
            st.buffered_mib = (buf.iter().map(|x| x.bytes).sum::<u64>() / (1024 * 1024)) as u32;
            if let Some(e) = sess.shared.error.lock().ok().and_then(|e| e.clone()) {
                st.error = Some(e);
            }
        }
        st
    }

    pub fn start(&self, app: &AppHandle, source: Source, keep_all: bool, game: GameInfo) -> AppResult<()> {
        let mut slot = self.session.lock().map_err(|_| AppError::Unavailable("état de capture".into()))?;
        if slot.is_some() {
            return Err(AppError::InvalidInput("une capture est déjà en cours".into()));
        }
        if self.finalizing.load(Ordering::SeqCst) {
            return Err(AppError::Unavailable("finalisation de l'enregistrement précédent en cours".into()));
        }
        let encoders = self.encoders();
        if encoders.is_empty() {
            return Err(AppError::Unavailable(
                "aucun encodeur H.264 matériel détecté : NEX ne bascule pas sur un encodage logiciel coûteux".into(),
            ));
        }
        let st = settings_of(app);
        let base = base_dir(app)?;
        std::fs::create_dir_all(&base).map_err(|e| AppError::Storage(e.to_string()))?;
        if free_space(&base).is_some_and(|f| f < MIN_FREE_BYTES) {
            return Err(AppError::Storage("moins de 2 Gio libres sur le disque des vidéos".into()));
        }
        let used = app.state::<AppState>().db.with(recordings::total_bytes)? as u64;
        if used >= st.storage_quota_gib as u64 * 1024 * 1024 * 1024 {
            return Err(AppError::Storage(format!("quota de {} Gio atteint : supprime des enregistrements ou augmente le quota", st.storage_quota_gib)));
        }

        let started_ms = now_ms();
        let dir = base.join(".buffer").join(started_ms.to_string());
        let shared = Arc::new(Shared::default());
        shared.keep_all.store(keep_all, Ordering::SeqCst);

        let (label, size) = match &source {
            Source::GameWindow => {
                let w = Window::from_name(GAME_WINDOW).map_err(|_| AppError::NotFound("fenêtre du jeu introuvable".into()))?;
                (GAME_WINDOW.to_string(), w.rect().ok().map(|r| ((r.right - r.left) as u32, (r.bottom - r.top) as u32)))
            }
            Source::Window(title) => {
                let w = Window::from_name(title).map_err(|_| AppError::NotFound(format!("fenêtre « {title} » introuvable")))?;
                (title.clone(), w.rect().ok().map(|r| ((r.right - r.left) as u32, (r.bottom - r.top) as u32)))
            }
            Source::PrimaryMonitor => {
                let m = Monitor::primary().map_err(|e| AppError::Unavailable(format!("écran principal : {e}")))?;
                ("Écran principal".to_string(), Some((m.width().unwrap_or(1920), m.height().unwrap_or(1080))))
            }
        };
        // Debit : ~0,18 bit/pixel/image (1080p30 ~ 11 Mbit/s, 1440p30 ~ 20 Mbit/s).
        let (w, h) = size.unwrap_or((1920, 1080));
        let bitrate = ((w as f64 * h as f64 * FPS as f64 * 0.18) as u32).clamp(4_000_000, 40_000_000);
        let cfg = EngineConfig {
            dir: dir.clone(),
            fps: FPS,
            bitrate,
            segment_ms: SEGMENT_MS,
            replay_ms: st.replay_seconds as i64 * 1000,
            replay_bytes: st.replay_max_mib as u64 * 1024 * 1024,
        };
        let flags = Flags { cfg, shared: shared.clone() };
        let interval = MinimumUpdateIntervalSettings::Custom(Duration::from_millis(1000 / FPS as u64));
        let control = match &source {
            Source::PrimaryMonitor => {
                let m = Monitor::primary().map_err(|e| AppError::Unavailable(e.to_string()))?;
                let s = Settings::new(m, CursorCaptureSettings::WithoutCursor, DrawBorderSettings::WithoutBorder, SecondaryWindowSettings::Default, interval, DirtyRegionSettings::Default, ColorFormat::Bgra8, flags);
                Recorder::start_free_threaded(s)
            }
            Source::GameWindow | Source::Window(_) => {
                let w = Window::from_name(&label).map_err(|_| AppError::NotFound("fenêtre introuvable".into()))?;
                let s = Settings::new(w, CursorCaptureSettings::WithoutCursor, DrawBorderSettings::WithoutBorder, SecondaryWindowSettings::Default, interval, DirtyRegionSettings::Default, ColorFormat::Bgra8, flags);
                Recorder::start_free_threaded(s)
            }
        }
        .map_err(|e| AppError::Unavailable(format!("démarrage de la capture : {e}")))?;

        if let Ok(mut e) = self.last_error.lock() {
            *e = None;
        }
        if let Ok(mut n) = self.auto_clipped.lock() {
            *n = 0;
        }
        *slot = Some(Session { control: Some(control), shared, dir, source: label, started_ms, keep_all, game, highlights: vec![], kda: None });
        drop(slot);
        let _ = app.emit("capture://status", self.status());
        Ok(())
    }

    /// Arrete la capture. La finalisation (et l'assemblage d'une partie complete) se fait en
    /// arriere-plan ; un evenement est emis a la fin.
    pub fn stop(self: &Arc<Self>, app: &AppHandle) -> AppResult<()> {
        let Some(mut sess) = self.session.lock().ok().and_then(|mut s| s.take()) else {
            return Ok(());
        };
        sess.shared.stop.store(true, Ordering::SeqCst);
        self.finalizing.store(true, Ordering::SeqCst);
        let _ = app.emit("capture://status", self.status());
        let this = self.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            // Laisse le moteur fermer lui-meme son segment (prochaine image), sinon arret force.
            std::thread::sleep(Duration::from_millis(300));
            if let Some(c) = sess.control.take() {
                let _ = c.stop();
            }
            sess.shared.wait_closed(Duration::from_secs(15));
            if sess.keep_all {
                if let Err(e) = this.finalize_full(&app, &sess) {
                    if let Ok(mut le) = this.last_error.lock() {
                        *le = Some(e.to_string());
                    }
                }
            }
            if let Some(e) = sess.shared.error.lock().ok().and_then(|e| e.clone()) {
                if let Ok(mut le) = this.last_error.lock() {
                    *le = Some(e);
                }
            }
            let _ = std::fs::remove_dir_all(&sess.dir);
            this.finalizing.store(false, Ordering::SeqCst);
            let _ = app.emit("capture://status", this.status());
            emit_changed(&app);
        });
        Ok(())
    }

    fn finalize_full(&self, app: &AppHandle, sess: &Session) -> AppResult<()> {
        let segs: Vec<_> = sess.shared.segments.lock().map(|b| b.iter().cloned().collect()).unwrap_or_default();
        if segs.is_empty() {
            return Ok(());
        }
        let out_dir = base_dir(app)?.join("Parties");
        std::fs::create_dir_all(&out_dir).map_err(|e| AppError::Storage(e.to_string()))?;
        let out = out_dir.join(format!("partie-{}.mp4", sess.started_ms));
        let info = remux::concat(&segs.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &out)?;
        let thumb = copy_thumb(&segs, segs.len() / 2, &out);
        let markers = markers_for(&sess.highlights, &sess.game, sess.started_ms, sess.started_ms, info.duration_ms as i64);
        let title = match &sess.game.champion_key {
            Some(c) => format!("Partie complète · {c}"),
            None => "Partie complète".into(),
        };
        app.state::<AppState>().db.with(|c| {
            recordings::insert(c, &NewRecording {
                kind: "full",
                title: &title,
                path: &out.to_string_lossy(),
                thumb: thumb.as_deref(),
                champion_key: sess.game.champion_key.as_deref(),
                game_mode: sess.game.game_mode.as_deref(),
                kda: sess.kda.as_deref(),
                duration_ms: info.duration_ms as i64,
                size_bytes: std::fs::metadata(&out).map(|m| m.len() as i64).unwrap_or(0),
                created_at: sess.started_ms,
                markers: &markers,
            })
        })?;
        Ok(())
    }

    /// Sauvegarde les `seconds` dernieres secondes du tampon en clip (bloquant : a appeler hors UI).
    pub fn save_clip(&self, app: &AppHandle, seconds: u32, title: Option<String>) -> AppResult<Recording> {
        let (shared, game, highlights, kda, started_ms) = {
            let s = self.session.lock().map_err(|_| AppError::Unavailable("état de capture".into()))?;
            let sess = s.as_ref().ok_or_else(|| AppError::Unavailable("aucune capture active : active le mode Capture d'abord".into()))?;
            (sess.shared.clone(), sess.game.clone(), sess.highlights.clone(), sess.kda.clone(), sess.started_ms)
        };
        // Force la finalisation du segment en cours pour inclure les dernieres secondes.
        // (Sans nouvelle image -- contenu immobile -- la rotation n'a pas lieu : on attend 4 s au plus.)
        let before = shared.finished_count.load(Ordering::SeqCst);
        shared.rotate.store(true, Ordering::SeqCst);
        let deadline = std::time::Instant::now() + Duration::from_secs(4);
        while std::time::Instant::now() < deadline {
            if shared.finished_count.load(Ordering::SeqCst) > before && shared.pending_finishes.load(Ordering::SeqCst) == 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let end = now_ms();
        let segs = shared.segments.lock().map(|b| segments::covering(&b, end, seconds as i64 * 1000)).unwrap_or_default();
        if segs.is_empty() {
            return Err(AppError::Unavailable("tampon vide : la capture vient de démarrer".into()));
        }
        let out_dir = base_dir(app)?.join("Clips");
        std::fs::create_dir_all(&out_dir).map_err(|e| AppError::Storage(e.to_string()))?;
        let created = now_ms();
        let out = out_dir.join(format!("clip-{created}.mp4"));
        let info = remux::concat(&segs.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &out)?;
        let thumb = copy_thumb(&segs, segs.len().saturating_sub(1), &out);
        let clip_start = segs.first().map(|s| s.started_ms).unwrap_or(end);
        let markers = markers_for(&highlights, &game, started_ms, clip_start, info.duration_ms as i64);
        let title = title.unwrap_or_else(|| "Replay instantané".into());
        let rec = app.state::<AppState>().db.with(|c| {
            recordings::insert(c, &NewRecording {
                kind: "clip",
                title: &title,
                path: &out.to_string_lossy(),
                thumb: thumb.as_deref(),
                champion_key: game.champion_key.as_deref(),
                game_mode: game.game_mode.as_deref(),
                kda: kda.as_deref(),
                duration_ms: info.duration_ms as i64,
                size_bytes: std::fs::metadata(&out).map(|m| m.len() as i64).unwrap_or(0),
                created_at: created,
                markers: &markers,
            })
        })?;
        emit_changed(app);
        Ok(rec)
    }

    /// Appele a chaque instantane de partie : met a jour les moments et declenche les clips auto.
    pub fn on_live(self: &Arc<Self>, app: &AppHandle, highlights: &[Highlight], kda: Option<String>, auto: bool) {
        let worthy: Vec<Highlight> = highlights.iter().filter(|h| h.clip_worthy).cloned().collect();
        {
            let mut s = self.session.lock().unwrap_or_else(|p| p.into_inner());
            let Some(sess) = s.as_mut() else { return };
            sess.highlights = highlights.to_vec();
            sess.kda = kda;
        }
        if !auto {
            return;
        }
        let mut done = self.auto_clipped.lock().unwrap_or_else(|p| p.into_inner());
        while *done < worthy.len() {
            let h = worthy[*done].clone();
            *done += 1;
            // Clip de 20 s, enregistre 6 s apres le moment pour inclure la suite de l'action.
            let this = self.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(6));
                let _ = this.save_clip(&app, 20, Some(h.label.clone()));
            });
        }
    }
}

fn copy_thumb(segs: &[segments::Segment], i: usize, out: &Path) -> Option<String> {
    let src = segs.get(i).and_then(|s| s.thumb.clone()).or_else(|| segs.iter().find_map(|s| s.thumb.clone()))?;
    let dst = out.with_extension("jpg");
    std::fs::copy(src, &dst).ok()?;
    Some(dst.to_string_lossy().into_owned())
}

/// Convertit les moments (temps de jeu) en marqueurs de la video [video_start_ms, +duration].
fn markers_for(h: &[Highlight], game: &GameInfo, capture_start_ms: i64, video_start_ms: i64, duration_ms: i64) -> Vec<Marker> {
    let Some(g0) = game.game_time_at_start else { return vec![] };
    h.iter()
        .filter_map(|x| {
            let wall = capture_start_ms + ((x.time - g0) * 1000.0) as i64;
            let t = wall - video_start_ms;
            (0..=duration_ms).contains(&t).then(|| Marker { t_ms: t, kind: x.kind.clone(), label: x.label.clone() })
        })
        .collect()
}

/// Au demarrage : sessions interrompues (arret brutal) recuperees en enregistrements incomplets.
pub fn recover(app: &AppHandle) {
    let Ok(base) = base_dir(app) else { return };
    let Ok(entries) = std::fs::read_dir(base.join(".buffer")) else { return };
    for e in entries.flatten() {
        let dir = e.path();
        let mut segs: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map(|r| r.flatten().map(|f| f.path()).filter(|p| p.extension().is_some_and(|x| x == "mp4")).collect())
            .unwrap_or_default();
        segs.sort();
        if !segs.is_empty() {
            let out_dir = base.join("Parties");
            let _ = std::fs::create_dir_all(&out_dir);
            let out = out_dir.join(format!("interrompu-{}.mp4", e.file_name().to_string_lossy()));
            if let Ok(info) = remux::concat(&segs, &out) {
                let created = e.file_name().to_string_lossy().parse::<i64>().unwrap_or(0);
                let _ = app.state::<AppState>().db.with(|c| {
                    let r = recordings::insert(c, &NewRecording {
                        kind: "full",
                        title: "Enregistrement interrompu (récupéré)",
                        path: &out.to_string_lossy(),
                        thumb: None,
                        champion_key: None,
                        game_mode: None,
                        kda: None,
                        duration_ms: info.duration_ms as i64,
                        size_bytes: std::fs::metadata(&out).map(|m| m.len() as i64).unwrap_or(0),
                        created_at: created,
                        markers: &[],
                    })?;
                    c.execute("UPDATE recordings SET complete = 0 WHERE id = ?1", [r.id])?;
                    Ok(())
                });
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Integration (fenetre « NEX » ouverte requise) :
    /// `cargo test -p nex --release -- --ignored capture_probe --nocapture`
    /// Capture uniquement la fenetre de NEX, 12 s, dans un dossier temporaire supprime ensuite.
    #[test]
    #[ignore]
    fn capture_probe() {
        let encoders = hw::hardware_h264_encoders();
        println!("encodeurs materiels : {encoders:?}");
        assert!(!encoders.is_empty());
        let dir = std::env::temp_dir().join(format!("nex-capture-probe-{}", std::process::id()));
        let shared = Arc::new(Shared::default());
        let cfg = EngineConfig { dir: dir.clone(), fps: FPS, bitrate: 12_000_000, segment_ms: 5_000, replay_ms: 120_000, replay_bytes: 512 * 1024 * 1024 };
        let title = std::env::var("NEX_PROBE_WINDOW").unwrap_or_else(|_| "NEX".into());
        let w = Window::from_name(&title).expect("fenetre de test introuvable");
        let s = Settings::new(
            w,
            CursorCaptureSettings::WithoutCursor,
            DrawBorderSettings::WithoutBorder,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Custom(Duration::from_millis(1000 / FPS as u64)),
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            Flags { cfg, shared: shared.clone() },
        );
        let t0 = std::time::Instant::now();
        let control = Recorder::start_free_threaded(s).expect("demarrage");
        std::thread::sleep(Duration::from_secs(12));
        shared.stop.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(300));
        let _ = control.stop();
        shared.wait_closed(Duration::from_secs(10));
        let segs: Vec<_> = shared.segments.lock().unwrap().iter().cloned().collect();
        println!(
            "duree {:?}, images envoyees {}, abandonnees {}, {}x{}, segments {}, erreur {:?}",
            t0.elapsed(),
            shared.frames_sent.load(Ordering::Relaxed),
            shared.frames_dropped.load(Ordering::Relaxed),
            shared.width.load(Ordering::Relaxed),
            shared.height.load(Ordering::Relaxed),
            segs.len(),
            shared.error.lock().unwrap()
        );
        assert!(!segs.is_empty(), "aucun segment finalise");
        let out = dir.join("probe.mp4");
        let info = remux::concat(&segs.iter().map(|s| s.path.clone()).collect::<Vec<_>>(), &out).expect("assemblage");
        let size = std::fs::metadata(&out).unwrap().len();
        println!("clip : {} ms, {} echantillons, {} octets, miniature {}", info.duration_ms, info.samples, size, segs[0].thumb.as_ref().is_some_and(|t| t.exists()));
        assert!(info.duration_ms >= 11_000, "le dernier segment partiel doit etre conserve");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn markers_map_game_time_to_video_time() {
        let h = vec![
            Highlight { time: 610.0, kind: "kill".into(), label: "K".into(), clip_worthy: false },
            Highlight { time: 700.0, kind: "ace".into(), label: "A".into(), clip_worthy: true },
        ];
        let g = GameInfo { game_time_at_start: Some(600.0), ..Default::default() };
        // Capture demarree a t=1_000_000 ms (temps de jeu 600 s) ; video commencant 5 s plus tard, 60 s.
        let m = markers_for(&h, &g, 1_000_000, 1_005_000, 60_000);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].t_ms, 5_000);
        assert!(markers_for(&h, &GameInfo::default(), 0, 0, 1).is_empty());
    }
}
