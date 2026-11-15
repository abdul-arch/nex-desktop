//! Limiteur de debit a fenetres glissantes, blocage global apres un 429 (Retry-After), et
//! budget partage entre les requetes interactives et le collecteur.
//!
//! Les deux priorites puisent dans les memes fenetres. Une requete interactive (profil,
//! parties, rangs, classement, partie en cours) prend un jeton des qu'il en reste un. Le
//! collecteur n'en prend un que s'il reste plus de `reserve` jetons libres : cette reserve
//! est gardee aux visiteurs, qui ne doivent jamais attendre derriere lui. Et des qu'une
//! requete interactive essuie un refus de debit, le collecteur se met en pause pour la duree
//! du Retry-After, puis reprend seul.
//!
//! POURQUOI : mesure du 15 novembre 2026, collecteur en marche, le profil du site a recu
//! deux 429 de suite (« reessayer dans 19 s », puis 21 s) avant de charger. Le collecteur
//! consommait la fenetre de 100 requetes / 2 min comme n'importe quelle requete, et un
//! profil a froid en vaut environ 34.

use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Priority {
    /// Requete d'un utilisateur : passe des qu'un jeton est libre.
    Interactive,
    /// Collecteur : ne passe que si la reserve reste libre, et se tait apres un refus interactif.
    Background,
}

pub struct RateLimiter {
    inner: Mutex<Inner>,
}

struct Inner {
    windows: Vec<Window>,
    /// 429 de Riot : plus personne n'emet avant cet instant.
    blocked_until: Option<Instant>,
    /// Pause du seul collecteur, apres un refus essuye par une requete interactive.
    background_paused_until: Option<Instant>,
}

struct Window {
    max: u32,
    /// Jetons que le collecteur laisse toujours libres dans cette fenetre.
    reserve: u32,
    span: Duration,
    hits: VecDeque<Instant>,
}

impl RateLimiter {
    /// `reserve` se compte en requetes de la plus grande fenetre (40 sur 100 / 2 min par
    /// defaut) ; chaque autre fenetre en garde la meme part (8 sur 20 / 1 s).
    pub fn new(limits: &[(u32, u64)], reserve: u32) -> Self {
        let quota = limits.iter().map(|&(max, _)| max).max().unwrap_or(0).max(1);
        let windows = limits
            .iter()
            .map(|&(max, secs)| Window {
                max,
                reserve: ((u64::from(max) * u64::from(reserve)).div_ceil(u64::from(quota)) as u32).min(max),
                span: Duration::from_secs(secs),
                hits: VecDeque::new(),
            })
            .collect();
        Self { inner: Mutex::new(Inner { windows, blocked_until: None, background_paused_until: None }) }
    }

    /// Temps d'attente avant de pouvoir emettre (None = immediat, et le jeton est pris).
    pub async fn try_acquire(&self, priority: Priority) -> Option<Duration> {
        let mut g = self.inner.lock().await;
        let now = Instant::now();
        let wait = g.wait(priority, now);
        if wait > Duration::ZERO {
            return Some(wait);
        }
        for w in g.windows.iter_mut() {
            w.hits.push_back(now);
        }
        None
    }

    /// Comme `try_acquire`, sans prendre le jeton : dit seulement combien de temps attendre.
    pub async fn delay(&self, priority: Priority) -> Option<Duration> {
        let mut g = self.inner.lock().await;
        let wait = g.wait(priority, Instant::now());
        (wait > Duration::ZERO).then_some(wait)
    }

    /// Attend un jeton, au plus `max_wait`. Renvoie l'attente restante si le delai est depasse.
    pub async fn acquire(&self, priority: Priority, max_wait: Duration) -> Result<(), Duration> {
        let deadline = Instant::now() + max_wait;
        loop {
            match self.try_acquire(priority).await {
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

    /// 429 de Riot : plus personne n'emet pendant `d`, quelle que soit la priorite.
    pub async fn block_for(&self, d: Duration) {
        let mut g = self.inner.lock().await;
        let until = Instant::now() + d;
        g.blocked_until = Some(g.blocked_until.map_or(until, |u| u.max(until)));
    }

    /// Une requete interactive vient d'etre refusee : le collecteur se tait pendant `d`, a
    /// compter de la levee du blocage global s'il y en a un. Le navigateur reessaie pile a
    /// cette levee ; le collecteur ne doit pas s'y trouver en meme temps.
    pub async fn pause_background(&self, d: Duration) {
        let mut g = self.inner.lock().await;
        let now = Instant::now();
        let from = g.blocked_until.filter(|u| *u > now).unwrap_or(now);
        let until = from + d;
        g.background_paused_until = Some(g.background_paused_until.map_or(until, |u| u.max(until)));
    }
}

impl Inner {
    /// Attente avant qu'une requete de cette priorite puisse partir (zero = tout de suite).
    /// Purge au passage les coups sortis des fenetres et les blocages echus.
    fn wait(&mut self, priority: Priority, now: Instant) -> Duration {
        let mut wait = Duration::ZERO;
        match self.blocked_until {
            Some(until) if until > now => wait = until - now,
            _ => self.blocked_until = None,
        }
        if priority == Priority::Background {
            match self.background_paused_until {
                Some(until) if until > now => wait = wait.max(until - now),
                _ => self.background_paused_until = None,
            }
        }
        for w in self.windows.iter_mut() {
            while w.hits.front().is_some_and(|t| now.duration_since(*t) >= w.span) {
                w.hits.pop_front();
            }
            let allowed = match priority {
                Priority::Interactive => w.max,
                Priority::Background => w.max - w.reserve,
            };
            if allowed == 0 {
                // Reserve egale a la fenetre : le collecteur n'a aucun jeton ici.
                wait = wait.max(w.span);
                continue;
            }
            let len = w.hits.len() as u32;
            if len >= allowed {
                // Le prochain jeton de cette priorite se libere quand ce coup-la sort de la fenetre.
                let liberateur = w.hits[(len - allowed) as usize];
                wait = wait.max(w.span - now.duration_since(liberateur));
            }
        }
        wait
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn enforces_window() {
        let l = RateLimiter::new(&[(3, 60)], 0);
        for _ in 0..3 {
            assert!(l.try_acquire(Priority::Interactive).await.is_none());
        }
        let wait = l.try_acquire(Priority::Interactive).await.expect("doit attendre");
        assert!(wait > Duration::from_secs(50));
        assert!(l.acquire(Priority::Interactive, Duration::from_millis(10)).await.is_err());
    }

    #[tokio::test]
    async fn block_after_429() {
        let l = RateLimiter::new(&[(100, 1)], 0);
        l.block_for(Duration::from_secs(5)).await;
        assert!(l.try_acquire(Priority::Interactive).await.is_some());
        assert!(l.try_acquire(Priority::Background).await.is_some());
    }

    /// 10 jetons par minute, 4 de reserve : le collecteur s'arrete au 7e, un visiteur prend
    /// les 4 restants, et seul le 11e jeton de la fenetre attend vraiment.
    #[tokio::test]
    async fn le_collecteur_s_arrete_a_la_reserve_et_le_visiteur_passe() {
        let l = RateLimiter::new(&[(10, 60)], 4);
        for i in 0..6 {
            assert!(l.try_acquire(Priority::Background).await.is_none(), "jeton collecteur {}", i + 1);
        }
        let wait = l.try_acquire(Priority::Background).await.expect("le 7e jeton entamerait la reserve");
        assert!(wait > Duration::from_secs(59), "attente du collecteur : {wait:?}");
        for i in 0..4 {
            assert!(l.try_acquire(Priority::Interactive).await.is_none(), "jeton visiteur {}", i + 1);
        }
        assert!(l.try_acquire(Priority::Interactive).await.is_some(), "fenetre pleine : le visiteur attend aussi");
        // Le collecteur ne remonte pas en tete de file pour autant.
        assert!(l.delay(Priority::Background).await.is_some());
    }

    /// Reserve exprimee sur la plus grande fenetre (40 sur 100) : la fenetre d'une seconde en
    /// garde la meme part (8 sur 20), et c'est elle qui freine le collecteur, pas les 2 min.
    #[tokio::test]
    async fn la_reserve_suit_la_proportion_de_chaque_fenetre() {
        let l = RateLimiter::new(&[(20, 1), (100, 120)], 40);
        for i in 0..12 {
            assert!(l.try_acquire(Priority::Background).await.is_none(), "jeton collecteur {}", i + 1);
        }
        let wait = l.try_acquire(Priority::Background).await.expect("13e : la reserve de la seconde");
        assert!(wait <= Duration::from_secs(1), "{wait:?}");
        for i in 0..8 {
            assert!(l.try_acquire(Priority::Interactive).await.is_none(), "jeton visiteur {}", i + 1);
        }
        assert!(l.try_acquire(Priority::Interactive).await.is_some());
    }

    /// Le collecteur attend que ses propres coups sortent de la fenetre, puis repart seul.
    #[tokio::test]
    async fn le_collecteur_reprend_quand_la_fenetre_se_vide() {
        let l = RateLimiter::new(&[(3, 1)], 1);
        assert!(l.try_acquire(Priority::Background).await.is_none());
        assert!(l.try_acquire(Priority::Background).await.is_none());
        let wait = l.delay(Priority::Background).await.expect("reserve atteinte");
        assert!(wait <= Duration::from_secs(1));
        let t = Instant::now();
        assert!(l.acquire(Priority::Background, Duration::from_secs(2)).await.is_ok());
        assert!(t.elapsed() >= Duration::from_millis(900), "a repris apres {:?}", t.elapsed());
    }

    /// Refus interactif : le collecteur se tait pour la duree annoncee, le visiteur non, puis
    /// le collecteur reprend sans qu'on le relance.
    #[tokio::test]
    async fn pause_apres_un_refus_interactif_puis_reprise() {
        let l = RateLimiter::new(&[(100, 60)], 10);
        l.pause_background(Duration::from_millis(300)).await;
        let wait = l.delay(Priority::Background).await.expect("collecteur en pause");
        assert!(wait <= Duration::from_millis(300));
        assert!(l.try_acquire(Priority::Interactive).await.is_none(), "le visiteur passe pendant la pause");
        tokio::time::sleep(Duration::from_millis(320)).await;
        assert!(l.try_acquire(Priority::Background).await.is_none(), "reprise seule a l'echeance");
    }

    /// 429 de Riot sur une requete interactive : tout le monde attend le Retry-After, et le
    /// collecteur encore autant apres la levee, le temps que le navigateur reessaie.
    #[tokio::test]
    async fn la_pause_du_collecteur_court_apres_le_blocage_global() {
        let l = RateLimiter::new(&[(100, 60)], 10);
        l.block_for(Duration::from_millis(300)).await;
        l.pause_background(Duration::from_millis(300)).await;
        let visiteur = l.delay(Priority::Interactive).await.expect("bloque");
        let collecteur = l.delay(Priority::Background).await.expect("bloque puis en pause");
        assert!(visiteur <= Duration::from_millis(300), "{visiteur:?}");
        assert!(collecteur > Duration::from_millis(500) && collecteur <= Duration::from_millis(600), "{collecteur:?}");
    }
}
