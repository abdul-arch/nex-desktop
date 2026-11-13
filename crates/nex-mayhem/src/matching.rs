//! Identification des cartes a partir des lignes lues a l'ecran (OCR local).
//!
//! Un titre exact (francais ou anglais, accents et ponctuation ignores) donne une
//! identification certaine. Une correspondance approchee n'est retenue que si elle est tres
//! proche ET nettement meilleure que la suivante ; sinon la carte est « ambigue » et ne
//! recoit pas de note certaine.

use crate::catalog::MayhemCatalog;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    /// Titre identique a un nom du catalogue.
    Exact,
    /// Tres proche d'un seul nom (erreur de lecture probable d'un caractere).
    Approx,
    /// Plusieurs noms possibles ou ressemblance insuffisante : pas de note certaine.
    Ambiguous,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identified {
    pub key: String,
    pub confidence: Confidence,
    /// Ressemblance 0-1 avec le nom retenu.
    pub similarity: f32,
}

/// Minuscules, sans accents (latin courant), uniquement lettres et chiffres.
pub fn normalize(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' => 'i',
            'ô' | 'ö' | 'ó' | 'õ' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ç' => 'c',
            'ÿ' => 'y',
            'œ' => 'o',
            c => c,
        })
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn levenshtein(a: &[u8], b: &[u8]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + usize::from(ca != cb));
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

fn similarity(a: &str, b: &str) -> f32 {
    let n = a.len().max(b.len());
    if n == 0 {
        return 0.0;
    }
    1.0 - levenshtein(a.as_bytes(), b.as_bytes()) as f32 / n as f32
}

/// Index des noms normalises (francais, anglais) -> cle du catalogue.
pub struct NameIndex {
    names: Vec<(String, String)>,
}

impl NameIndex {
    pub fn new(catalog: &MayhemCatalog) -> Self {
        let mut names = Vec::new();
        for a in &catalog.augments {
            for n in [&a.name_fr, &a.name_en] {
                let k = normalize(n);
                if k.len() >= 3 && !names.iter().any(|(x, key): &(String, String)| x == &k && key == &a.key) {
                    names.push((k, a.key.clone()));
                }
            }
        }
        Self { names }
    }
}

pub const APPROX_MIN: f32 = 0.86;
pub const APPROX_MARGIN: f32 = 0.10;
pub const AMBIGUOUS_MIN: f32 = 0.72;

/// Identifie un texte lu. `None` si rien n'est assez proche pour etre un titre d'augment.
pub fn identify(index: &NameIndex, text: &str) -> Option<Identified> {
    let t = normalize(text);
    if t.len() < 3 || t.len() > 48 {
        return None;
    }
    // Titres exacts : plusieurs augments peuvent partager un nom traduit ; c'est alors ambigu.
    let exact: Vec<&String> = index.names.iter().filter(|(n, _)| *n == t).map(|(_, k)| k).collect();
    if let Some(first) = exact.first() {
        let unique = exact.iter().all(|k| k == first);
        return Some(Identified { key: (*first).clone(), confidence: if unique { Confidence::Exact } else { Confidence::Ambiguous }, similarity: 1.0 });
    }
    // Meilleure ressemblance par augment (ses noms francais et anglais), puis les deux premiers.
    let mut per_key: std::collections::BTreeMap<&String, f32> = std::collections::BTreeMap::new();
    for (n, k) in &index.names {
        let s = similarity(&t, n);
        let e = per_key.entry(k).or_insert(0.0);
        *e = e.max(s);
    }
    let mut ranked: Vec<(&String, f32)> = per_key.into_iter().collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let (k, s) = *ranked.first()?;
    let second = ranked.get(1).map_or(0.0, |x| x.1);
    let confidence = if s >= APPROX_MIN && s - second >= APPROX_MARGIN && t.len() >= 6 {
        Confidence::Approx
    } else if s >= AMBIGUOUS_MIN {
        Confidence::Ambiguous
    } else {
        return None;
    };
    Some(Identified { key: k.clone(), confidence, similarity: s })
}

/// Ligne lue a l'ecran, en fractions de la fenetre du jeu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLine {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// Titre de carte detecte, avec sa position (fractions de la fenetre du jeu).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardTitle {
    pub text: String,
    pub identified: Identified,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// Trouve les titres d'augments parmi les lignes lues, y compris un titre coupe sur deux
/// lignes alignees. Resultat trie de gauche a droite ; une seule carte par colonne.
pub fn find_titles(index: &NameIndex, lines: &[TextLine]) -> Vec<CardTitle> {
    let mut out: Vec<CardTitle> = Vec::new();
    let mut used = vec![false; lines.len()];
    let push = |text: String, id: Identified, x: f32, y: f32, w: f32, h: f32, out: &mut Vec<CardTitle>| {
        out.push(CardTitle { text, identified: id, x, y, w, h });
    };
    for (i, l) in lines.iter().enumerate() {
        if let Some(id) = identify(index, &l.text).filter(|id| id.confidence != Confidence::Ambiguous || id.similarity >= 0.8) {
            used[i] = true;
            push(l.text.clone(), id, l.x, l.y, l.w, l.h, &mut out);
        }
    }
    // Titres sur deux lignes : ligne suivante juste en dessous et centree sur la meme colonne.
    for i in 0..lines.len() {
        if used[i] {
            continue;
        }
        let a = &lines[i];
        let below = lines.iter().enumerate().find(|(j, b)| {
            *j != i && !used[*j] && b.y > a.y && b.y - (a.y + a.h) < a.h * 1.2 && ((b.x + b.w / 2.0) - (a.x + a.w / 2.0)).abs() < 0.03
        });
        if let Some((j, b)) = below {
            let text = format!("{} {}", a.text, b.text);
            if let Some(id) = identify(index, &text).filter(|id| id.confidence != Confidence::Ambiguous) {
                used[i] = true;
                used[j] = true;
                let x = a.x.min(b.x);
                let w = (a.x + a.w).max(b.x + b.w) - x;
                push(text, id, x, a.y, w, b.y + b.h - a.y, &mut out);
            }
        }
    }
    select_row(out)
}

/// Les titres des cartes proposees sont alignes sur une meme ligne et repartis sur plusieurs
/// colonnes. Garde la ligne horizontale la plus fournie (au moins deux colonnes distinctes) :
/// une liste verticale de noms affichee par une autre application ne forme pas de « cartes ».
fn select_row(mut titles: Vec<CardTitle>) -> Vec<CardTitle> {
    const ROW_TOLERANCE: f32 = 0.012;
    const MIN_COLUMN_GAP: f32 = 0.06;
    let cy = |t: &CardTitle| t.y + t.h / 2.0;
    let cx = |t: &CardTitle| t.x + t.w / 2.0;
    titles.sort_by(|a, b| cx(a).total_cmp(&cx(b)));
    let mut best: Vec<CardTitle> = Vec::new();
    for anchor in &titles {
        let mut row: Vec<CardTitle> = Vec::new();
        // Alignes par le haut ou par le centre (un titre peut tenir sur deux lignes).
        let aligned = |t: &&CardTitle| (t.y - anchor.y).abs() <= ROW_TOLERANCE || (cy(t) - cy(anchor)).abs() <= ROW_TOLERANCE;
        for t in titles.iter().filter(aligned) {
            match row.last_mut() {
                // Meme colonne : garde le titre le plus sur.
                Some(last) if cx(t) - cx(last) < MIN_COLUMN_GAP => {
                    if t.identified.similarity > last.identified.similarity {
                        *last = t.clone();
                    }
                }
                _ => row.push(t.clone()),
            }
        }
        if row.len() > best.len() {
            best = row;
        }
    }
    if best.len() >= 2 { best } else { Vec::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{Augment, Rarity};

    fn catalog() -> MayhemCatalog {
        let a = |key: &str, en: &str, fr: &str| Augment { id: 0, key: key.into(), name_en: en.into(), name_fr: fr.into(), rarity: Rarity::Gold, icon: String::new() };
        MayhemCatalog {
            mode: "KIWI".into(),
            patch: "t".into(),
            fetched_at: 0,
            source: "test".into(),
            augments: vec![
                a("ARAM_ProteinShake", "Protein Shake", "Boisson énergisante"),
                a("GlassCannon", "Glass Cannon", "Canon de verre"),
                a("CriticalRhythm", "Critical Rhythm", "Rythme critique"),
                a("Twin_A", "Twin Blade", "Lame jumelle"),
                a("Twin_B", "Twin Blades", "Lames jumelles"),
            ],
        }
    }

    #[test]
    fn exact_approx_and_ambiguous() {
        let idx = NameIndex::new(&catalog());
        assert_eq!(identify(&idx, "BOISSON ÉNERGISANTE").unwrap().confidence, Confidence::Exact);
        assert_eq!(identify(&idx, "Glass Cannon").unwrap().key, "GlassCannon");
        // Un caractere mal lu : approche, mais certain car aucun autre nom proche.
        let ap = identify(&idx, "Glass Cann0n").unwrap();
        assert_eq!((ap.key.as_str(), ap.confidence), ("GlassCannon", Confidence::Approx));
        // Deux noms tres proches : jamais une note certaine.
        assert_ne!(identify(&idx, "Twin Bladez").unwrap().confidence, Confidence::Exact);
        assert_ne!(identify(&idx, "Twin Bladez").unwrap().confidence, Confidence::Approx);
        assert!(identify(&idx, "Prochain objet").is_none());
        assert!(identify(&idx, "Gain 20% attack speed for 3 seconds after hitting a champion").is_none());
    }

    #[test]
    fn titles_sorted_and_two_line_titles() {
        let idx = NameIndex::new(&catalog());
        let l = |text: &str, x: f32, y: f32, w: f32| TextLine { text: text.into(), x, y, w, h: 0.02 };
        let lines = vec![
            l("Rythme critique", 0.60, 0.40, 0.08),
            l("Boisson", 0.30, 0.40, 0.06),
            l("énergisante", 0.29, 0.425, 0.08),
            l("Canon de verre", 0.45, 0.40, 0.08),
            l("Inflige des dégâts supplémentaires", 0.44, 0.50, 0.12),
        ];
        let t = find_titles(&idx, &lines);
        let keys: Vec<&str> = t.iter().map(|c| c.identified.key.as_str()).collect();
        assert_eq!(keys, ["ARAM_ProteinShake", "GlassCannon", "CriticalRhythm"]);
    }
}
