use crate::persistence::Db;

/// Etat partage du noyau. Les ressources lourdes (capture, LCU, overlay) seront
/// creees a la demande et liberees en fin d'usage, pas stockees ici en permanence.
pub struct AppState {
    pub db: Db,
    pub http: reqwest::Client,
}
