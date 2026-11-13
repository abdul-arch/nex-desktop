//! Assemblage de segments MP4 (H.264) en un seul fichier, sans reencodage : les echantillons
//! deja encodes sont recopies avec des horodatages decales. Les segments doivent partager les
//! memes parametres (SPS/PPS, resolution, echelle de temps), ce qui est verifie.

use crate::error::{AppError, AppResult};
use mp4::{AvcConfig, MediaConfig, Mp4Config, Mp4Reader, Mp4Writer, TrackConfig, TrackType};
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};

/// Resultat d'assemblage (samples, largeur, hauteur : diagnostic et tests).
#[allow(dead_code)]
pub struct RemuxInfo {
    pub duration_ms: u64,
    pub samples: u32,
    pub width: u16,
    pub height: u16,
}

fn err(e: impl std::fmt::Display) -> AppError {
    AppError::Storage(format!("assemblage vidéo : {e}"))
}

fn open(path: &Path) -> AppResult<Mp4Reader<BufReader<File>>> {
    let f = File::open(path).map_err(err)?;
    let size = f.metadata().map_err(err)?.len();
    Mp4Reader::read_header(BufReader::new(f), size).map_err(err)
}

fn video_track(r: &Mp4Reader<BufReader<File>>) -> AppResult<u32> {
    r.tracks()
        .iter()
        .find(|(_, t)| matches!(t.track_type(), Ok(TrackType::Video)))
        .map(|(id, _)| *id)
        .ok_or_else(|| err("aucune piste vidéo"))
}

/// Concatene `segments` dans `out` (ecrit d'abord `out.part`, renomme a la fin).
pub fn concat(segments: &[PathBuf], out: &Path) -> AppResult<RemuxInfo> {
    let first = segments.first().ok_or_else(|| err("aucun segment"))?;
    let r0 = open(first)?;
    let t0 = video_track(&r0)?;
    let track = &r0.tracks()[&t0];
    let sps = track.sequence_parameter_set().map_err(err)?.to_vec();
    let pps = track.picture_parameter_set().map_err(err)?.to_vec();
    let (width, height, timescale) = (track.width(), track.height(), track.timescale());
    drop(r0);

    let part = out.with_extension("mp4.part");
    let file = File::create(&part).map_err(err)?;
    let config = Mp4Config {
        major_brand: str::parse("isom").map_err(err)?,
        minor_version: 512,
        compatible_brands: ["isom", "iso2", "avc1", "mp41"].iter().map(|b| str::parse(b)).collect::<Result<_, _>>().map_err(err)?,
        timescale: 1000,
    };
    let mut w = Mp4Writer::write_start(BufWriter::new(file), &config).map_err(err)?;
    w.add_track(&TrackConfig {
        track_type: TrackType::Video,
        timescale,
        language: "und".into(),
        media_conf: MediaConfig::AvcConfig(AvcConfig { width, height, seq_param_set: sps.clone(), pic_param_set: pps.clone() }),
    })
    .map_err(err)?;

    let mut offset: u64 = 0;
    let mut samples = 0u32;
    for seg in segments {
        let mut r = open(seg)?;
        let tid = video_track(&r)?;
        {
            let t = &r.tracks()[&tid];
            if t.timescale() != timescale || t.sequence_parameter_set().map_err(err)? != sps.as_slice() || t.picture_parameter_set().map_err(err)? != pps.as_slice() {
                let _ = std::fs::remove_file(&part);
                return Err(err("segments incompatibles (paramètres d'encodage différents)"));
            }
        }
        let count = r.sample_count(tid).map_err(err)?;
        let mut end = 0u64;
        for i in 1..=count {
            if let Some(mut s) = r.read_sample(tid, i).map_err(err)? {
                end = end.max(s.start_time + s.duration as u64);
                s.start_time += offset;
                w.write_sample(1, &s).map_err(err)?;
                samples += 1;
            }
        }
        offset += end;
    }
    w.write_end().map_err(err)?;
    drop(w);
    std::fs::rename(&part, out).map_err(err)?;
    Ok(RemuxInfo { duration_ms: offset * 1000 / timescale.max(1) as u64, samples, width, height })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mp4::Mp4Sample;

    /// Segment synthetique : SPS/PPS factices, `n` echantillons de 1/30 s (timescale 30000).
    fn segment(path: &Path, n: u32, sps: &[u8]) {
        let f = File::create(path).unwrap();
        let config = Mp4Config { major_brand: str::parse("isom").unwrap(), minor_version: 512, compatible_brands: vec![str::parse("isom").unwrap()], timescale: 1000 };
        let mut w = Mp4Writer::write_start(BufWriter::new(f), &config).unwrap();
        w.add_track(&TrackConfig {
            track_type: TrackType::Video,
            timescale: 30000,
            language: "und".into(),
            media_conf: MediaConfig::AvcConfig(AvcConfig { width: 64, height: 36, seq_param_set: sps.to_vec(), pic_param_set: vec![0x68, 0xce, 0x3c, 0x80] }),
        })
        .unwrap();
        for i in 0..n {
            let s = Mp4Sample { start_time: i as u64 * 1000, duration: 1000, rendering_offset: 0, is_sync: i == 0, bytes: bytes::Bytes::from(vec![0, 0, 0, 1, 0x65, i as u8]) };
            w.write_sample(1, &s).unwrap();
        }
        w.write_end().unwrap();
    }

    #[test]
    fn concatenates_without_reencoding() {
        let dir = std::env::temp_dir().join(format!("nex-remux-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let sps = [0x67, 0x64, 0x00, 0x1f, 0xac];
        let a = dir.join("a.mp4");
        let b = dir.join("b.mp4");
        segment(&a, 30, &sps);
        segment(&b, 15, &sps);
        let out = dir.join("out.mp4");
        let info = concat(&[a.clone(), b.clone()], &out).unwrap();
        assert_eq!(info.samples, 45);
        assert_eq!(info.duration_ms, 1500);
        let mut r = open(&out).unwrap();
        let t = video_track(&r).unwrap();
        let s31 = r.read_sample(t, 31).unwrap().unwrap();
        assert_eq!(s31.start_time, 30_000); // decale de la duree du premier segment
        assert!(s31.is_sync);
        assert!(!dir.join("out.mp4.part").exists());

        // Parametres differents : refuse.
        let c = dir.join("c.mp4");
        segment(&c, 5, &[0x67, 0x42, 0x00, 0x1e, 0x99]);
        assert!(concat(&[a, c], &dir.join("bad.mp4")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
