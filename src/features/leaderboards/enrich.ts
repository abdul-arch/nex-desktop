// Enrichissement progressif des joueurs d'un classement : icone d'invocateur (profil) et
// mesures calculees sur les dernieres parties de la file (role, KDA, champions).
//
// Quota Riot : une cle de developpement autorise environ 100 requetes par 2 minutes, et un
// joueur jamais vu en coute une quinzaine. L'analyse est donc etalee : un joueur a la fois,
// les trois premiers sans attente, puis une pause entre chaque joueur pour laisser de la
// marge a la navigation. Les joueurs qui ne sont plus affiches quittent la file d'attente.
import { useEffect, useState } from "react";
import { toSummary } from "../../domain/fromMatch";
import { samplePlayer, type PlayerSample } from "../../domain/playerSample";
import type { MatchSummary } from "../../domain/types";
import { platform } from "../../platform";

/** Nombre de parties analysees par joueur. */
export const SAMPLE_SIZE = 10;
/** Pause entre deux joueurs au-dela des trois premiers. */
const GAP_MS = 20_000;
/** Pause apres un echec (quota atteint, reseau) avant de reprendre la file. */
const BACKOFF_MS = 60_000;

export interface PlayerExtra {
  state: "ready" | "error";
  profileIconId: number | null;
  sample: PlayerSample | null;
}

export interface EnrichTarget {
  puuid: string;
  riotId: string | null;
  /** Region du compte, si differente de celle de la page (classement d'une equipe). */
  platform?: string;
}

interface Job extends EnrichTarget {
  key: string;
  plat: string;
  queueId: number;
  urgent: boolean;
}

const done = new Map<string, PlayerExtra>();
const listeners = new Set<() => void>();
let queue: Job[] = [];
let running = false;
let nextAt = 0;

const keyOf = (plat: string, queueId: number, puuid: string) => `${plat}:${queueId}:${puuid}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function load(j: Job): Promise<PlayerExtra> {
  // Les deux lectures sont independantes : l'echec de l'une n'efface pas l'autre.
  const [profile, page] = await Promise.allSettled([
    j.riotId ? platform.playerProfile(j.riotId, j.plat) : Promise.reject(new Error("Riot ID inconnu")),
    platform.playerMatches({ platform: j.plat, puuid: j.puuid, start: 0, count: SAMPLE_SIZE, queue: j.queueId }),
  ]);
  const sample =
    page.status === "fulfilled"
      ? samplePlayer(page.value.matches.map((m) => toSummary(m, j.puuid)).filter((s): s is MatchSummary => s !== null))
      : null;
  const profileIconId = profile.status === "fulfilled" ? profile.value.profileIconId : null;
  return { state: sample === null ? "error" : "ready", profileIconId, sample };
}

async function work() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue[0];
    const wait = job.urgent ? 0 : nextAt - Date.now();
    if (wait > 0) {
      await sleep(Math.min(wait, 1000));
      continue; // la file a pu changer pendant l'attente
    }
    queue = queue.filter((q) => q.key !== job.key);
    const extra = await load(job).catch((): PlayerExtra => ({ state: "error", profileIconId: null, sample: null }));
    done.set(job.key, extra);
    nextAt = Date.now() + (extra.state === "error" ? BACKOFF_MS : GAP_MS);
    listeners.forEach((l) => l());
  }
  running = false;
}

/** Oublie les lectures echouees (quota Riot, reseau) pour qu'« Actualiser » les retente. */
export function retryFailedExtras() {
  for (const [k, e] of done) if (e.state === "error") done.delete(k);
  nextAt = 0;
}

/**
 * Mesures des joueurs affiches, dans l'ordre donne (les premiers d'abord). Renvoie une table
 * par PUUID ; un joueur absent de la table est en attente. La file d'attente est remplacee
 * par les joueurs affiches : changer de region ou de file abandonne les analyses non commencees.
 */
export function usePlayerExtras(plat: string, queueId: number, targets: EnrichTarget[], attempt = 0): Map<string, PlayerExtra> {
  const [, bump] = useState(0);
  const ids = targets.map((t) => `${t.puuid}|${t.riotId ?? ""}`).join(",");
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    queue = targets
      .map((t, i): Job => ({ ...t, key: keyOf(t.platform ?? plat, queueId, t.puuid), plat: t.platform ?? plat, queueId, urgent: i < 3 }))
      .filter((j) => !done.has(j.key));
    void work();
    return () => {
      listeners.delete(l);
      queue = [];
    };
  }, [plat, queueId, ids, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = new Map<string, PlayerExtra>();
  for (const t of targets) {
    const e = done.get(keyOf(t.platform ?? plat, queueId, t.puuid));
    if (e) out.set(t.puuid, e);
  }
  return out;
}
