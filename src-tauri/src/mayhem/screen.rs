//! Lecture locale des titres de cartes : copie GDI de la zone utile de la fenetre du jeu
//! (seulement quand le jeu est au premier plan), puis OCR integre a Windows.
//! Aucune image n'est conservee ni envoyee ; aucune lecture de la memoire du jeu.

use crate::error::{AppError, AppResult};
use nex_mayhem::matching::TextLine;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Globalization::Language;
use windows::Media::Ocr::OcrEngine;
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SRCCOPY, SelectObject,
};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetClientRect, GetForegroundWindow, IsIconic};
use windows::core::w;

/// Zone lue, en fractions de la zone client du jeu : bande horizontale des titres et effets.
/// Mesure sur trois phases reelles (2560x1440) : la bande 20-65 % lit les 9 titres en 38-41 ms ;
/// la zone 10-90 % ne renvoie aucune ligne (l'OCR Windows echoue sur une zone trop chargee).
pub const ZONE: [f32; 4] = [0.15, 0.20, 0.70, 0.45];

/// Rectangle client du jeu en pixels ecran.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Fenetre du jeu, seulement si elle est au premier plan et non reduite.
pub fn foreground_game() -> Option<(HWND, GameRect)> {
    unsafe {
        let hwnd = FindWindowW(None, w!("League of Legends (TM) Client")).ok()?;
        if GetForegroundWindow() != hwnd || IsIconic(hwnd).as_bool() {
            return None;
        }
        let mut rc = RECT::default();
        GetClientRect(hwnd, &mut rc).ok()?;
        let mut p = POINT { x: 0, y: 0 };
        if !ClientToScreen(hwnd, &mut p).as_bool() {
            return None;
        }
        let (w, h) = (rc.right - rc.left, rc.bottom - rc.top);
        (w >= 640 && h >= 360).then_some((hwnd, GameRect { x: p.x, y: p.y, w, h }))
    }
}

/// Copie BGRA (opaque) de la zone utile. Renvoie (pixels, largeur, hauteur, decalage x, y).
pub fn grab(game: GameRect) -> AppResult<(Vec<u8>, i32, i32, i32, i32)> {
    let ox = (game.w as f32 * ZONE[0]) as i32;
    let oy = (game.h as f32 * ZONE[1]) as i32;
    let w = (game.w as f32 * ZONE[2]) as i32;
    let h = (game.h as f32 * ZONE[3]) as i32;
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp.into());
        let ok = BitBlt(mem, 0, 0, w, h, Some(screen), game.x + ox, game.y + oy, SRCCOPY).is_ok();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // de haut en bas
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(mem, bmp, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if !ok || lines == 0 {
            return Err(AppError::Unavailable("copie de l'écran impossible".into()));
        }
        // GDI laisse l'alpha a zero : image opaque pour l'OCR.
        for a in px.iter_mut().skip(3).step_by(4) {
            *a = 255;
        }
        Ok((px, w, h, ox, oy))
    }
}

/// Empreinte grossiere (grille 32x18 de luminance) pour ne pas relire une image identique.
pub fn fingerprint(px: &[u8], w: i32, h: i32) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for gy in 0..18 {
        for gx in 0..32 {
            let x = (gx * w / 32).min(w - 1);
            let y = (gy * h / 18).min(h - 1);
            let i = ((y * w + x) * 4) as usize;
            let lum = (px[i] as u32 + px[i + 1] as u32 * 2 + px[i + 2] as u32) / 4 / 16; // 16 niveaux
            hash = (hash ^ lum as u64).wrapping_mul(0x100000001b3);
        }
    }
    hash
}

pub struct Reader {
    engine: OcrEngine,
    pub lang: String,
}

impl Reader {
    /// `lang` : langue du client (`fr-FR`, `en-US`...). Repli sur la langue du profil Windows.
    pub fn new(lang: &str) -> AppResult<Self> {
        let err = |e: windows::core::Error| AppError::Unavailable(format!("OCR Windows indisponible : {e}"));
        let engine = Language::CreateLanguage(&windows::core::HSTRING::from(lang))
            .and_then(|l| OcrEngine::TryCreateFromLanguage(&l))
            .or_else(|_| OcrEngine::TryCreateFromUserProfileLanguages())
            .map_err(err)?;
        let used = engine.RecognizerLanguage().and_then(|l| l.LanguageTag()).map(|t| t.to_string()).unwrap_or_default();
        Ok(Self { engine, lang: used })
    }

    /// Lignes lues, en fractions de la zone client du jeu.
    pub fn read(&self, px: &[u8], w: i32, h: i32, ox: i32, oy: i32, game: GameRect) -> AppResult<Vec<TextLine>> {
        let err = |e: windows::core::Error| AppError::Unavailable(format!("lecture OCR : {e}"));
        let buf = CryptographicBuffer::CreateFromByteArray(px).map_err(err)?;
        let bmp = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(&buf, BitmapPixelFormat::Bgra8, w, h, BitmapAlphaMode::Premultiplied).map_err(err)?;
        // Attente bloquante : appele depuis le fil de lecture dedie, jamais depuis l'interface.
        let result = self.engine.RecognizeAsync(&bmp).map_err(err)?.join().map_err(err)?;
        let mut out = Vec::new();
        for line in result.Lines().map_err(err)? {
            let text = line.Text().map_err(err)?.to_string();
            let (mut x1, mut y1, mut x2, mut y2) = (f32::MAX, f32::MAX, 0f32, 0f32);
            for word in line.Words().map_err(err)? {
                let r = word.BoundingRect().map_err(err)?;
                x1 = x1.min(r.X);
                y1 = y1.min(r.Y);
                x2 = x2.max(r.X + r.Width);
                y2 = y2.max(r.Y + r.Height);
            }
            if x2 <= x1 {
                continue;
            }
            out.push(TextLine {
                text,
                x: (ox as f32 + x1) / game.w as f32,
                y: (oy as f32 + y1) / game.h as f32,
                w: (x2 - x1) / game.w as f32,
                h: (y2 - y1) / game.h as f32,
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Chaine reelle (copie GDI + OCR Windows + identification) sur l'ecran principal entier,
    /// considere comme la zone client du jeu. Affiche une capture du jeu en plein ecran avant :
    /// `cargo test -p nex --lib -- --ignored ocr_screen_probe --nocapture`.
    #[test]
    #[ignore]
    fn ocr_screen_probe() {
        let cat: nex_mayhem::MayhemCatalog =
            serde_json::from_str(include_str!("../../../crates/nex-mayhem/tests/fixtures/catalog-kiwi-16.22.json").trim_start_matches('\u{feff}')).unwrap();
        let idx = nex_mayhem::matching::NameIndex::new(&cat);
        let (w, h) = unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
            (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))
        };
        let game = GameRect { x: 0, y: 0, w, h };
        let reader = Reader::new(&std::env::var("NEX_OCR_LANG").unwrap_or("en-US".into())).unwrap();
        for run in 0..3 {
            let t0 = std::time::Instant::now();
            let (px, cw, ch, ox, oy) = grab(game).unwrap();
            let t_grab = t0.elapsed();
            let lines = reader.read(&px, cw, ch, ox, oy, game).unwrap();
            let t_ocr = t0.elapsed() - t_grab;
            let titles = nex_mayhem::matching::find_titles(&idx, &lines);
            println!(
                "essai {run}: ecran {w}x{h}, zone {cw}x{ch}, copie {} ms, OCR {} ms ({}), {} lignes, cartes: {}",
                t_grab.as_millis(),
                t_ocr.as_millis(),
                reader.lang,
                lines.len(),
                titles.iter().map(|t| format!("{} [{:?}] x={:.3} y={:.3}", t.identified.key, t.identified.confidence, t.x + t.w / 2.0, t.y)).collect::<Vec<_>>().join(" | ")
            );
        }
    }
}
