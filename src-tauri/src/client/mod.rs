//! Integration avec le client League local : etat, selection des champions, partie en direct,
//! imports. Rien de tout cela n'existe dans la version web.
pub mod collection;
#[cfg(test)]
mod e2e;
pub mod history;
pub mod imports;
pub mod model;
pub mod service;
pub mod spectate;
