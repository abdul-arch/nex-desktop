use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use nex_domain::api::ApiError;

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("{0}")]
    InvalidInput(String),
    #[error("{0}")]
    NotFound(String),
    #[error("limite de debit Riot atteinte, reessayer dans {0} s")]
    RateLimited(u64),
    /// Cle absente, expiree ou refusee ; service non configure.
    #[error("{0}")]
    Unavailable(String),
    /// Erreur Riot (5xx) ou reponse illisible.
    #[error("{0}")]
    Upstream(String),
    #[error("erreur interne")]
    Internal(String),
    /// Requete venant d'un autre site (navigateur) ou d'un hote non local.
    #[error("{0}")]
    Forbidden(String),
}

impl From<nex_domain::InvalidInput> for BackendError {
    fn from(e: nex_domain::InvalidInput) -> Self {
        BackendError::InvalidInput(e.0)
    }
}

impl From<rusqlite::Error> for BackendError {
    fn from(e: rusqlite::Error) -> Self {
        BackendError::Internal(format!("stockage : {e}"))
    }
}

impl From<serde_json::Error> for BackendError {
    fn from(e: serde_json::Error) -> Self {
        BackendError::Upstream(format!("reponse illisible : {e}"))
    }
}

impl IntoResponse for BackendError {
    fn into_response(self) -> Response {
        let (status, code, retry) = match &self {
            BackendError::InvalidInput(_) => (StatusCode::BAD_REQUEST, "invalid_input", None),
            BackendError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found", None),
            BackendError::RateLimited(s) => (StatusCode::TOO_MANY_REQUESTS, "rate_limited", Some(*s)),
            BackendError::Unavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, "unavailable", None),
            BackendError::Upstream(_) => (StatusCode::BAD_GATEWAY, "upstream", None),
            BackendError::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden", None),
            BackendError::Internal(detail) => {
                tracing::error!("erreur interne : {detail}");
                (StatusCode::INTERNAL_SERVER_ERROR, "upstream", None)
            }
        };
        let body = ApiError { code: code.into(), message: self.to_string(), retry_after_secs: retry };
        let mut resp = (status, Json(body)).into_response();
        if let Some(s) = retry {
            if let Ok(v) = HeaderValue::from_str(&s.to_string()) {
                resp.headers_mut().insert(header::RETRY_AFTER, v);
            }
        }
        resp
    }
}

pub type BResult<T> = Result<T, BackendError>;
