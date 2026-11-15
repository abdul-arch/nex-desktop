//! Journal des paniques.
//!
//! POURQUOI CE MODULE : l'application s'est arretee cinq fois dans l'apres-midi du
//! 15 novembre 2026 sans laisser la moindre trace — aucun evenement dans le journal
//! Windows, aucun fichier de vidage. J'en avais conclu qu'elle etait fermee a la main.
//! C'etait faux.
//!
//! Le profil release porte `panic = "abort"` : une panique dans n'importe quel fil tue le
//! processus sur-le-champ, sans deroulement de pile, sans fenetre d'erreur. `strip = true`
//! efface en prime les symboles, donc meme un vidage memoire n'aurait rien dit. Un
//! `eprintln!` ne sert a rien non plus : une application de bureau n'a pas de console ou
//! ecrire.
//!
//! Le hook de panique, lui, s'execute AVANT l'abandon du processus. C'est la derniere
//! occasion d'ecrire ce qui vient de se passer, et ce fichier est donc le seul endroit ou
//! une panique laissera une trace.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// Nom du fichier, dans le dossier de donnees de l'application.
pub const FICHIER: &str = "paniques.log";

/// Dossier de donnees, construit sans passer par Tauri : le hook doit etre pose avant que
/// l'application ne soit batie, sinon une panique au demarrage echapperait au journal.
pub fn dossier() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("gg.nex.desktop"))
}

/// Pose le hook. A appeler une seule fois, le plus tot possible.
///
/// Le hook precedent est conserve et rappele : on ajoute une trace, on ne remplace pas le
/// comportement par defaut.
pub fn journaliser(dossier: PathBuf) {
    let precedent = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let ou = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "lieu inconnu".into());
        // Le contenu d'une panique est soit un `&str`, soit une `String` : les deux formes
        // existent selon qu'on a passe un litteral ou un message formate.
        let quoi = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panique sans message".into());
        let fil = std::thread::current().name().unwrap_or("fil sans nom").to_string();
        let quand = horodatage();
        let ligne = format!("{quand} | fil {fil} | {ou} | {quoi}\n");

        let _ = std::fs::create_dir_all(&dossier);
        let _ = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dossier.join(FICHIER))
            .and_then(|mut f| f.write_all(ligne.as_bytes()));

        precedent(info);
    }));
}

/// Secondes depuis l'epoch, en clair. Pas de dependance de date ici : ce code tourne
/// pendant une panique, il doit etre aussi simple que possible.
fn horodatage() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => format!("{}", d.as_secs()),
        Err(_) => "0".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ecrit_la_panique_dans_le_fichier() {
        let dir = std::env::temp_dir().join(format!("nex-paniques-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        journaliser(dir.clone());

        // Une panique attrapee : le hook s'execute quand meme, c'est tout l'interet.
        let _ = std::panic::catch_unwind(|| panic!("essai de journal"));

        let contenu = std::fs::read_to_string(dir.join(FICHIER)).expect("le journal doit exister");
        assert!(contenu.contains("essai de journal"), "le message manque : {contenu}");
        assert!(contenu.contains("paniques.rs"), "le lieu manque : {contenu}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn le_dossier_suit_appdata() {
        // Sur Windows APPDATA est toujours defini ; ailleurs la fonction rend None plutot
        // que d'inventer un chemin.
        match dossier() {
            Some(p) => assert!(p.ends_with("gg.nex.desktop")),
            None => assert!(std::env::var_os("APPDATA").is_none()),
        }
    }
}
