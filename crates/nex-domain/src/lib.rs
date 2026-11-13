//! Domaine NEX partage entre l'application desktop et le backend.
//! Aucun IO ici : uniquement des regles et des types serialisables.

pub mod api;
pub mod riot;

/// Erreur de validation du domaine.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct InvalidInput(pub String);

pub type DomainResult<T> = Result<T, InvalidInput>;
