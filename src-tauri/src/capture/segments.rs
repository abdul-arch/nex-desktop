//! Tampon de replay : segments deja encodes sur disque, bornes a la fois en duree et en taille.

use std::collections::VecDeque;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub index: u64,
    pub path: PathBuf,
    pub thumb: Option<PathBuf>,
    /// Debut (ms, horloge murale) et duree reelle.
    pub started_ms: i64,
    pub duration_ms: i64,
    pub bytes: u64,
}

/// Retire les segments les plus anciens jusqu'a respecter les deux limites. Le segment le plus
/// recent est toujours conserve. Renvoie les segments retires (a supprimer du disque).
pub fn prune(buf: &mut VecDeque<Segment>, max_ms: i64, max_bytes: u64) -> Vec<Segment> {
    let mut removed = Vec::new();
    loop {
        let total_ms: i64 = buf.iter().map(|s| s.duration_ms).sum();
        let total_bytes: u64 = buf.iter().map(|s| s.bytes).sum();
        if buf.len() <= 1 || (total_ms <= max_ms && total_bytes <= max_bytes) {
            break;
        }
        // On garde de quoi couvrir max_ms : on ne retire que si le reste suffit encore.
        let oldest = buf.front().expect("non vide");
        if total_bytes <= max_bytes && total_ms - oldest.duration_ms < max_ms {
            break;
        }
        removed.push(buf.pop_front().expect("non vide"));
    }
    removed
}

/// Segments necessaires pour couvrir les `window_ms` dernieres millisecondes (jusqu'a `end_ms`).
pub fn covering(buf: &VecDeque<Segment>, end_ms: i64, window_ms: i64) -> Vec<Segment> {
    let from = end_ms - window_ms;
    buf.iter().filter(|s| s.started_ms + s.duration_ms > from && s.started_ms < end_ms).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(i: u64, bytes: u64) -> Segment {
        Segment { index: i, path: PathBuf::from(format!("s{i}.mp4")), thumb: None, started_ms: i as i64 * 10_000, duration_ms: 10_000, bytes }
    }

    #[test]
    fn prune_by_duration_keeps_enough_history() {
        let mut b: VecDeque<_> = (0..20).map(|i| seg(i, 10)).collect();
        let removed = prune(&mut b, 120_000, u64::MAX);
        // 120 s couverts : 12 segments suffisent, mais on garde 13 tant que le plus ancien est utile.
        assert!(b.len() >= 12 && b.len() <= 13);
        assert_eq!(removed.len() + b.len(), 20);
        assert_eq!(b.back().unwrap().index, 19);
    }

    #[test]
    fn prune_by_size_wins() {
        let mut b: VecDeque<_> = (0..10).map(|i| seg(i, 100)).collect();
        prune(&mut b, i64::MAX, 350);
        assert_eq!(b.len(), 3);
        // Un segment unique trop gros est conserve (le plus recent).
        let mut one: VecDeque<_> = vec![seg(0, 10_000)].into();
        prune(&mut one, 1, 1);
        assert_eq!(one.len(), 1);
    }

    #[test]
    fn covering_window() {
        let b: VecDeque<_> = (0..10).map(|i| seg(i, 1)).collect();
        let c = covering(&b, 100_000, 25_000);
        assert_eq!(c.iter().map(|s| s.index).collect::<Vec<_>>(), vec![7, 8, 9]);
    }
}
