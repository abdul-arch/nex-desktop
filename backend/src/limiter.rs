//! Limiteur de debit a fenetres glissantes + blocage global apres un 429 (Retry-After).

use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub struct RateLimiter {
    inner: Mutex<Inner>,
}

struct Inner {
    windows: Vec<Window>,
    blocked_until: Option<Instant>,
}

struct Window {
    max: u32,
    span: Duration,
    hits: VecDeque<Instant>,
}

impl RateLimiter {
    pub fn new(limits: &[(u32, u64)]) -> Self {
        let windows = limits
            .iter()
            .map(|&(max, secs)| Window { max, span: Duration::from_secs(secs), hits: VecDeque::new() })
            .collect();
        Self { inner: Mutex::new(Inner { windows, blocked_until: None }) }
    }

    /// Temps d'attente avant de pouvoir emettre une requete (None = immediat, et le jeton est pris).
    pub async fn try_acquire(&self) -> Option<Duration> {
        let mut g = self.inner.lock().await;
        let now = Instant::now();
        if let Some(until) = g.blocked_until {
            if until > now {
                return Some(until - now);
            }
            g.blocked_until = None;
        }
        let mut wait = Duration::ZERO;
        for w in g.windows.iter_mut() {
            while w.hits.front().is_some_and(|t| now.duration_since(*t) >= w.span) {
                w.hits.pop_front();
            }
            if w.hits.len() as u32 >= w.max {
                let oldest = *w.hits.front().expect("fenetre pleine non vide");
                wait = wait.max(w.span - now.duration_since(oldest));
            }
        }
        if wait > Duration::ZERO {
            return Some(wait);
        }
        for w in g.windows.iter_mut() {
            w.hits.push_back(now);
        }
        None
    }

    /// Attend un jeton, au plus `max_wait`. Renvoie l'attente restante si le delai est depasse.
    pub async fn acquire(&self, max_wait: Duration) -> Result<(), Duration> {
        let deadline = Instant::now() + max_wait;
        loop {
            match self.try_acquire().await {
                None => return Ok(()),
                Some(wait) => {
                    if Instant::now() + wait > deadline {
                        return Err(wait);
                    }
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    pub async fn block_for(&self, d: Duration) {
        let mut g = self.inner.lock().await;
        let until = Instant::now() + d;
        g.blocked_until = Some(g.blocked_until.map_or(until, |u| u.max(until)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn enforces_window() {
        let l = RateLimiter::new(&[(3, 60)]);
        for _ in 0..3 {
            assert!(l.try_acquire().await.is_none());
        }
        let wait = l.try_acquire().await.expect("doit attendre");
        assert!(wait > Duration::from_secs(50));
        assert!(l.acquire(Duration::from_millis(10)).await.is_err());
    }

    #[tokio::test]
    async fn block_after_429() {
        let l = RateLimiter::new(&[(100, 1)]);
        l.block_for(Duration::from_secs(5)).await;
        assert!(l.try_acquire().await.is_some());
    }
}
