//! Erreurs normalisees renvoyees au frontend sous la forme `{ code, message }`.
//! Les codes sont stables et testes cote TypeScript (src/platform/contracts.ts).

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Saisie invalide (Riot ID mal forme, cle de reglage inconnue...).
    #[error("{0}")]
    InvalidInput(String),
    #[error("{0}")]
    NotFound(String),
    /// Appel IPC depuis une fenetre non autorisee pour cette commande.
    #[error("action non autorisee depuis cette fenetre")]
    Forbidden,
    #[error("erreur reseau : {0}")]
    Network(String),
    #[error("limite de debit atteinte, reessayer dans {retry_after_secs} s")]
    RateLimited { retry_after_secs: u64 },
    #[error("erreur de stockage local : {0}")]
    Storage(String),
    /// Fonction ou source de donnees non disponible (backend absent, client ferme...).
    #[error("{0}")]
    Unavailable(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::InvalidInput(_) => "invalid_input",
            AppError::NotFound(_) => "not_found",
            AppError::Forbidden => "forbidden",
            AppError::Network(_) => "network",
            AppError::RateLimited { .. } => "rate_limited",
            AppError::Storage(_) => "storage",
            AppError::Unavailable(_) => "unavailable",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = serializer.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<nex_domain::InvalidInput> for AppError {
    fn from(e: nex_domain::InvalidInput) -> Self {
        AppError::InvalidInput(e.0)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Storage(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            AppError::Network("delai depasse".into())
        } else if e.is_connect() {
            AppError::Network("connexion impossible".into())
        } else {
            // Le message reqwest peut contenir l'URL : pas de jeton dans nos URLs.
            AppError::Network(e.to_string())
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Storage(format!("donnees illisibles : {e}"))
    }
}

pub type AppResult<T> = Result<T, AppError>;
