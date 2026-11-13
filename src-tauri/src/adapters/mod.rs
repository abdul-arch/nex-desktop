//! Adaptateurs vers les sources externes. Chaque source a son module :
//! - `ddragon` : ressources statiques publiques (versions, catalogue, fiches champions)
//! - `backend` : backend NEX (seul detenteur de la cle Riot)
//! - `lcu` : client League local et Live Client Data (TLS epingle sur la racine Riot)
pub mod backend;
pub mod cdragon;
pub mod ddragon;
pub mod lcu;
