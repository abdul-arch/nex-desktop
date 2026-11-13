//! Moteur de capture : Windows.Graphics.Capture -> encodeur H.264 materiel (Media Foundation),
//! par segments de quelques secondes deja encodes sur disque.
//!
//! - Les images restent des textures GPU de bout en bout (aucun transit par le CPU ni par l'IPC),
//!   sauf une miniature 320x180 lue une fois par segment.
//! - Cadence plafonnee : intervalle minimal WGC + rejet des images trop rapprochees (politique
//!   explicite : on abandonne l'image, on ne la met jamais en file d'attente).
//! - Rotation des segments sans reencodage ; la finalisation d'un segment se fait hors du fil de
//!   capture.

use super::segments::{self, Segment};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, ImageEncoder, ImageEncoderPixelFormat, ImageFormat, VideoEncoder,
    VideoSettingsBuilder, VideoSettingsSubType,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;

#[derive(Clone, Debug)]
pub struct EngineConfig {
    pub dir: PathBuf,
    pub fps: u32,
    pub bitrate: u32,
    pub segment_ms: i64,
    /// Limites du tampon de replay (ignorees si `keep_all`).
    pub replay_ms: i64,
    pub replay_bytes: u64,
}

/// Etat partage entre le fil de capture et le service.
#[derive(Default)]
pub struct Shared {
    pub segments: Mutex<VecDeque<Segment>>,
    /// Conserver tous les segments (enregistrement de partie complete).
    pub keep_all: AtomicBool,
    pub rotate: AtomicBool,
    pub stop: AtomicBool,
    pub error: Mutex<Option<String>>,
    pub frames_sent: AtomicU64,
    pub frames_dropped: AtomicU64,
    pub width: AtomicU32,
    pub height: AtomicU32,
    /// Nombre de segments finalises (reussis ou non), pour attendre une rotation.
    pub finished_count: AtomicU64,
    pub pending_finishes: AtomicU32,
    /// Le moteur a ferme son dernier segment (arret effectif).
    pub closed: AtomicBool,
}

impl Shared {
    /// Attend la fermeture du moteur puis la finalisation de tous les segments (bornee).
    pub fn wait_closed(&self, max: Duration) {
        let deadline = Instant::now() + max;
        while !self.closed.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        while self.pending_finishes.load(Ordering::SeqCst) > 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

pub struct Flags {
    pub cfg: EngineConfig,
    pub shared: Arc<Shared>,
}

struct Current {
    encoder: VideoEncoder,
    index: u64,
    part: PathBuf,
    path: PathBuf,
    thumb: Option<PathBuf>,
    started: Instant,
    started_ms: i64,
    width: u32,
    height: u32,
}

pub struct Recorder {
    cfg: EngineConfig,
    shared: Arc<Shared>,
    current: Option<Current>,
    next_index: u64,
    last_frame_ts: Option<i64>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Miniature 320x180 (plus proche voisin) encodee en JPEG par WIC.
fn thumbnail(frame: &mut Frame, path: &PathBuf) -> Option<()> {
    let buf = frame.buffer().ok()?;
    let (w, h) = (buf.width() as usize, buf.height() as usize);
    if w == 0 || h == 0 {
        return None;
    }
    let mut raw = Vec::new();
    let src = buf.as_nopadding_buffer(&mut raw);
    let (tw, th) = (320usize, 180usize);
    let mut out = vec![0u8; tw * th * 4];
    for y in 0..th {
        let sy = y * h / th;
        for x in 0..tw {
            let sx = x * w / tw;
            let s = (sy * w + sx) * 4;
            let d = (y * tw + x) * 4;
            out[d..d + 4].copy_from_slice(&src[s..s + 4]);
        }
    }
    let jpeg = ImageEncoder::new(ImageFormat::Jpeg, ImageEncoderPixelFormat::Bgra8).ok()?.encode(&out, tw as u32, th as u32).ok()?;
    std::fs::write(path, jpeg).ok()
}

impl Recorder {
    fn open_segment(&mut self, frame: &mut Frame) -> Result<(), String> {
        // Dimensions paires (exigence H.264).
        let width = frame.width() & !1;
        let height = frame.height() & !1;
        let index = self.next_index;
        self.next_index += 1;
        let path = self.cfg.dir.join(format!("seg-{index:06}.mp4"));
        let part = self.cfg.dir.join(format!("seg-{index:06}.mp4.part"));
        let encoder = VideoEncoder::new(
            VideoSettingsBuilder::new(width, height)
                .sub_type(VideoSettingsSubType::H264)
                .bitrate(self.cfg.bitrate)
                .frame_rate(self.cfg.fps),
            AudioSettingsBuilder::new().disabled(true),
            ContainerSettingsBuilder::new(),
            &part,
        )
        .map_err(|e| format!("encodeur : {e}"))?;
        let thumb = self.cfg.dir.join(format!("seg-{index:06}.jpg"));
        let thumb = thumbnail(frame, &thumb).map(|_| thumb);
        self.shared.width.store(width, Ordering::Relaxed);
        self.shared.height.store(height, Ordering::Relaxed);
        self.current = Some(Current { encoder, index, part, path, thumb, started: Instant::now(), started_ms: now_ms(), width, height });
        Ok(())
    }

    /// Finalise le segment courant dans un fil a part, puis l'ajoute au tampon (avec rotation).
    fn close_segment(&mut self) {
        let Some(cur) = self.current.take() else { return };
        let shared = self.shared.clone();
        let cfg = self.cfg.clone();
        shared.pending_finishes.fetch_add(1, Ordering::SeqCst);
        std::thread::spawn(move || {
            let duration_ms = cur.started.elapsed().as_millis() as i64;
            let result = cur.encoder.finish();
            let ok = result.is_ok() && std::fs::rename(&cur.part, &cur.path).is_ok();
            if ok {
                let bytes = std::fs::metadata(&cur.path).map(|m| m.len()).unwrap_or(0);
                let seg = Segment { index: cur.index, path: cur.path, thumb: cur.thumb, started_ms: cur.started_ms, duration_ms, bytes };
                if let Ok(mut buf) = shared.segments.lock() {
                    buf.push_back(seg);
                    buf.make_contiguous().sort_by_key(|s| s.index);
                    if !shared.keep_all.load(Ordering::SeqCst) {
                        for old in segments::prune(&mut buf, cfg.replay_ms, cfg.replay_bytes) {
                            let _ = std::fs::remove_file(&old.path);
                            if let Some(t) = old.thumb {
                                let _ = std::fs::remove_file(t);
                            }
                        }
                    }
                }
            } else {
                // Fichier incomplet : jamais expose comme segment valide.
                let _ = std::fs::remove_file(&cur.part);
                if let Ok(mut e) = shared.error.lock() {
                    *e = Some(match result {
                        Err(e) => format!("finalisation d'un segment : {e}"),
                        Ok(_) => "écriture d'un segment impossible (disque plein ?)".into(),
                    });
                }
            }
            shared.finished_count.fetch_add(1, Ordering::SeqCst);
            shared.pending_finishes.fetch_sub(1, Ordering::SeqCst);
        });
    }

    fn fail(&mut self, msg: String) {
        if let Ok(mut e) = self.shared.error.lock() {
            *e = Some(msg);
        }
        self.shared.stop.store(true, Ordering::SeqCst);
    }
}

impl Drop for Recorder {
    /// Arret sans nouvelle image (contenu immobile, arret demande) : le segment en cours est
    /// tout de meme finalise, jamais abandonne en fichier .part.
    fn drop(&mut self) {
        self.close_segment();
        self.shared.closed.store(true, Ordering::SeqCst);
    }
}

impl GraphicsCaptureApiHandler for Recorder {
    type Flags = Flags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        std::fs::create_dir_all(&ctx.flags.cfg.dir).map_err(|e| e.to_string())?;
        Ok(Self { cfg: ctx.flags.cfg, shared: ctx.flags.shared, current: None, next_index: 0, last_frame_ts: None })
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
        if self.shared.stop.load(Ordering::SeqCst) {
            self.close_segment();
            self.shared.closed.store(true, Ordering::SeqCst);
            control.stop();
            return Ok(());
        }
        // Cadence : on abandonne les images trop rapprochees (jamais de file qui grossit).
        let ts = frame.timestamp().map(|t| t.Duration).unwrap_or(0); // unites de 100 ns
        let min_gap = 10_000_000 / self.cfg.fps.max(1) as i64 * 9 / 10;
        if let Some(last) = self.last_frame_ts {
            if ts - last < min_gap {
                self.shared.frames_dropped.fetch_add(1, Ordering::Relaxed);
                return Ok(());
            }
        }
        self.last_frame_ts = Some(ts);

        let resized = self.current.as_ref().is_some_and(|c| c.width != (frame.width() & !1) || c.height != (frame.height() & !1));
        let due = self.current.as_ref().is_some_and(|c| c.started.elapsed() >= Duration::from_millis(self.cfg.segment_ms as u64));
        if self.current.is_none() || due || resized || self.shared.rotate.swap(false, Ordering::SeqCst) {
            self.close_segment();
            if let Err(e) = self.open_segment(frame) {
                self.fail(e);
                control.stop();
                return Ok(());
            }
        }
        if let Some(cur) = self.current.as_mut() {
            if let Err(e) = cur.encoder.send_frame(frame) {
                let msg = format!("envoi d'image à l'encodeur : {e}");
                self.close_segment();
                self.fail(msg);
                control.stop();
                return Ok(());
            }
            self.shared.frames_sent.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        // Fenetre capturee fermee (fin de partie, jeu quitte) : on finalise proprement.
        self.close_segment();
        self.shared.stop.store(true, Ordering::SeqCst);
        Ok(())
    }
}
