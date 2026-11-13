// Conversion d'un match du backend vers la vue d'un joueur (MatchSummary) et
// calculs derives (adversaire direct, ecart d'or @15, ordre d'achat, competences).
import type { MatchDto, ParticipantDto, TimelineDto, TimelineEventDto } from "../platform/api";
import type { MatchSummary, Queue, Role } from "./types";

const ROLES: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

/** File ARAM Mayhem. L'API publique de Riot ne fournit pas ces parties : elles sont lues dans le client League. */
export const MAYHEM_QUEUE = 2400;

/**
 * Ajoute a une page de parties Riot les parties lues dans le client (ARAM Mayhem), sans
 * doublon, les plus recentes d'abord.
 * Tant que Riot a d'autres parties plus anciennes a charger (`hasMore`), seules les parties
 * locales plus recentes que la plus ancienne partie Riot affichee sont ajoutees : l'ordre
 * chronologique reste juste quand on charge la page suivante.
 */
export function mergeLocalMatches(remote: MatchDto[], local: MatchDto[], hasMore: boolean): MatchDto[] {
  if (local.length === 0) return remote;
  const known = new Set(remote.map((m) => m.id));
  const oldest = remote.length ? Math.min(...remote.map((m) => m.startedAt)) : null;
  const extra = local.filter((m) => !known.has(m.id) && (!hasMore || (oldest !== null && m.startedAt >= oldest)));
  return [...remote, ...extra].sort((a, b) => b.startedAt - a.startedAt);
}

export function findParticipant(m: MatchDto, puuid: string): ParticipantDto | undefined {
  return m.participants.find((p) => p.puuid === puuid);
}

/** Adversaire direct : meme poste dans l'equipe adverse (Faille uniquement). */
export function laneOpponent(m: MatchDto, me: ParticipantDto): ParticipantDto | undefined {
  if (!me.position) return undefined;
  return m.participants.find((p) => p.teamId !== me.teamId && p.position === me.position);
}

export function teamOf(m: MatchDto, teamId: number): ParticipantDto[] {
  return m.participants.filter((p) => p.teamId === teamId);
}

/** Ecart d'or a 15:00 avec l'adversaire direct ; null si timeline ou adversaire absents. */
export function goldDiffAt15(m: MatchDto, me: ParticipantDto): number | null {
  if (!m.goldAt15) return null;
  const opp = laneOpponent(m, me);
  if (!opp) return null;
  const i = m.participants.indexOf(me);
  const j = m.participants.indexOf(opp);
  const a = m.goldAt15[i];
  const b = m.goldAt15[j];
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}

/** Vue du match pour `puuid`. null si le joueur n'y figure pas. */
export function toSummary(m: MatchDto, puuid: string): MatchSummary | null {
  const me = findParticipant(m, puuid);
  if (!me) return null;
  const team = teamOf(m, me.teamId);
  const queue: Queue = m.queue === "arena" || m.gameMode === "CHERRY" ? "other" : m.queue;
  return {
    id: m.id,
    queue,
    mayhem: m.queueId === MAYHEM_QUEUE,
    champion: me.champion,
    championLevel: me.championLevel,
    role: me.position && (ROLES as string[]).includes(me.position) ? (me.position as Role) : null,
    win: me.win,
    remake: m.remake,
    startedAt: m.startedAt,
    durationSec: m.durationSec,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.cs,
    teamKills: team.reduce((a, p) => a + p.kills, 0),
    damageToChampions: me.damageToChampions,
    teamDamageToChampions: team.reduce((a, p) => a + p.damageToChampions, 0),
    visionScore: me.visionScore,
    soloKills: me.soloKills,
    goldDiffAt15: goldDiffAt15(m, me),
    // Non fourni par match-v5 : une variation de LP exige des observations enregistrees.
    lpDelta: null,
  };
}

export interface PurchaseStep {
  timestamp: number;
  itemId: number;
  kind: "buy" | "sell";
}

/**
 * Ordre d'achat reel d'un participant : achats et ventes, en annulant les paires
 * achat/annulation (ITEM_UNDO). Les objets detruits (consommes, ameliores) ne sont pas retires
 * de l'historique : c'est un ordre d'achat, pas un inventaire.
 */
export function purchaseOrder(t: TimelineDto, participantId: number): PurchaseStep[] {
  const out: PurchaseStep[] = [];
  const evs = t.events.filter((e) => e.participantId === participantId);
  for (const e of evs) {
    if (e.kind === "item_purchased" && e.itemId) out.push({ timestamp: e.timestamp, itemId: e.itemId, kind: "buy" });
    else if (e.kind === "item_sold" && e.itemId) out.push({ timestamp: e.timestamp, itemId: e.itemId, kind: "sell" });
    else if (e.kind === "item_undo") {
      // beforeId = objet concerne par l'annulation ; on retire la derniere action correspondante.
      const target = e.beforeItemId && e.beforeItemId !== 0 ? e.beforeItemId : e.itemId;
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].itemId === target) {
          out.splice(i, 1);
          break;
        }
      }
    }
  }
  return out;
}

/** Groupes d'achats separes par plus de 45 s (approximation des retours a la base). */
export function groupPurchases(steps: PurchaseStep[], gapMs = 45_000): PurchaseStep[][] {
  const groups: PurchaseStep[][] = [];
  for (const s of steps) {
    const last = groups[groups.length - 1];
    if (last && s.timestamp - last[last.length - 1].timestamp <= gapMs) last.push(s);
    else groups.push([s]);
  }
  return groups;
}

/** Ordre des competences (1 = Q/A, 2 = W/Z, 3 = E, 4 = R). */
export function skillOrder(t: TimelineDto, participantId: number): number[] {
  return t.events
    .filter((e): e is TimelineEventDto & { skillSlot: number } => e.kind === "skill_level_up" && e.participantId === participantId && !!e.skillSlot)
    .map((e) => e.skillSlot);
}

/** Series or/CS par minute pour un participant. */
export function perMinuteSeries(t: TimelineDto, participantId: number) {
  return t.frames.map((f) => {
    const p = f.players.find((x) => x.participantId === participantId);
    return { minute: Math.round(f.timestamp / 60000), gold: p?.totalGold ?? null, cs: p?.cs ?? null };
  });
}

export function skillLabel(slot: number, keys: "AZER" | "QWER"): string {
  const map = keys === "AZER" ? ["A", "Z", "E", "R"] : ["Q", "W", "E", "R"];
  return map[slot - 1] ?? "?";
}
