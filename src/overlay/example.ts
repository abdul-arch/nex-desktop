// Jeu de valeurs d'exemple pour les apercus hors partie.
//
// POURQUOI CE FICHIER EXISTE : la page Overlays montre chaque widget tel qu'il
// s'affichera en jeu. En partie, l'apercu utilise l'instantane reel. Hors partie, il faut
// bien lui donner quelque chose — et ce quelque chose doit etre reconnaissable comme un
// exemple, jamais confondu avec une vraie partie.
//
// REGLE : toute surface qui rend un widget a partir de ces valeurs porte la mention
// « exemple ». Ces valeurs ne doivent jamais atteindre la fenetre d'overlay en partie :
// OverlayApp ne les importe pas, il ne lit que `platform.liveSnapshot()`.

import type { ChampionBuildDto, LivePlayer, LiveSnapshot, LoadingRosterDto, PlayerRanksDto, WinProbDto } from "../platform/api";

// Les cles de champion sont celles de Data Dragon (« JarvanIV », pas « Jarvan IV ») :
// c'est ce que le client local fournit, derive de `rawChampionName`, et c'est ce que
// les URL d'illustration acceptent.
const p = (
  riotId: string,
  championKey: string,
  team: string,
  position: string,
  kills: number,
  deaths: number,
  assists: number,
  cs: number,
  extra: Partial<LivePlayer> = {},
): LivePlayer => ({
  riotId,
  championKey,
  team,
  position,
  level: 11,
  kills,
  deaths,
  assists,
  cs,
  items: [],
  isDead: false,
  respawnTimer: 0,
  isActive: false,
  ...extra,
});

/**
 * Une 15e minute plausible, avec un ecart d'or qui tombe dans une case reellement
 * observee de la grille de probabilite (+2K) : l'apercu montre ainsi un widget peuple
 * plutot que son etat « pas assez observe ».
 */
export const EXAMPLE_SNAPSHOT: LiveSnapshot = {
  gameTime: 900,
  gameMode: "CLASSIC",
  activeLevel: 12,
  abilities: [5, 3, 2, 1],
  unspentPoints: 1,
  currentGold: 740,
  players: [
    p("Exemple#EUW", "Ahri", "ORDER", "MIDDLE", 4, 1, 3, 128, { isActive: true, items: [3340], level: 12 }),
    p("Allie1#EUW", "Jinx", "ORDER", "BOTTOM", 3, 2, 2, 140),
    p("Allie2#EUW", "Leona", "ORDER", "UTILITY", 0, 2, 6, 16),
    p("Allie3#EUW", "JarvanIV", "ORDER", "JUNGLE", 2, 2, 5, 88),
    p("Allie4#EUW", "Garen", "ORDER", "TOP", 2, 2, 1, 118),
    p("Rival1#EUW", "Zed", "CHAOS", "MIDDLE", 2, 4, 2, 112, { isDead: true, respawnTimer: 21 }),
    p("Rival2#EUW", "Caitlyn", "CHAOS", "BOTTOM", 4, 2, 2, 131),
    p("Rival3#EUW", "Thresh", "CHAOS", "UTILITY", 0, 3, 6, 18),
    p("Rival4#EUW", "LeeSin", "CHAOS", "JUNGLE", 1, 3, 4, 78),
    p("Rival5#EUW", "Sett", "CHAOS", "TOP", 2, 2, 3, 104),
  ],
  objectives: [
    { kind: "dragon", nextSpawn: 1000, source: "event" },
    { kind: "baron", nextSpawn: 1200, source: "first_spawn" },
  ],
};

const scope = { patch: "all", platform: "all", queueId: 420, tier: "all", matches: 0 };

/** Build d'exemple : Chapeau de Rabadon (3089) en premier objet du build principal. */
export const EXAMPLE_BUILD: ChampionBuildDto = {
  scope,
  championId: 103,
  position: "MIDDLE",
  games: 0,
  wins: 0,
  positions: [],
  // Page complete : [style principal, 4 perks, style secondaire, 2 perks, 3 fragments].
  runePages: [{ ids: [8100, 8112, 8126, 8138, 8135, 8200, 8210, 8237, 5008, 5008, 5001], games: 240, wins: 132 }],
  spells: [{ ids: [4, 14], games: 240, wins: 132 }],
  startItems: [{ ids: [1056, 2003], games: 240, wins: 132 }],
  coreItems: [{ ids: [3089, 3157, 3135], games: 240, wins: 132 }],
  boots: [],
  lateItems: [],
  skillPriority: [{ ids: [2, 1, 3], games: 240, wins: 132 }],
  skillStart: [],
  timelineGames: 240,
};

/** Grille d'exemple : une seule case, celle que l'instantane d'exemple vise. */
export const EXAMPLE_GRID: WinProbDto = {
  cells: [{ minute: 15, bucket: 2, games: 135, wins: 92 }],
  observations: 0,
  minGames: 60,
  maxBucket: 10,
};

/**
 * Counters d'exemple, pour l'apercu de la page de reglages. Les chiffres sont
 * illustratifs et la carte qui les porte est marquee « exemple ».
 */
export const EXAMPLE_COUNTERS = {
  enemy: "Zed",
  items: [
    { championId: 84, score: 6.1, reasons: [], games: 3120, adjustedWinRate: 0.527, laneAdvantage: { pp: 4.2, games: 180 } },
    { championId: 38, score: 4.4, reasons: [], games: 2410, adjustedWinRate: 0.514, laneAdvantage: { pp: 3.1, games: 96 } },
    { championId: 134, score: 3.2, reasons: [], games: 1870, adjustedWinRate: 0.509, laneAdvantage: { pp: 2.4, games: 74 } },
  ],
};

/**
 * Composition d'exemple, pour regarder le panneau de chargement hors partie. Les
 * identifiants sont ceux de Data Dragon pour les memes champions que l'instantane.
 */
export const EXAMPLE_ROSTER: LoadingRosterDto = {
  gameId: 0,
  queueId: 420,
  players: [
    { puuid: "x1", gameName: "Exemple", tagLine: "EUW", team: 1, championId: 103, isMe: true },
    { puuid: "x2", gameName: "Allie1", tagLine: "EUW", team: 1, championId: 222, isMe: false },
    { puuid: "x3", gameName: "Allie2", tagLine: "EUW", team: 1, championId: 89, isMe: false },
    { puuid: "x4", gameName: "Allie3", tagLine: "EUW", team: 1, championId: 59, isMe: false },
    { puuid: "x5", gameName: "Allie4", tagLine: "EUW", team: 1, championId: 86, isMe: false },
    { puuid: "y1", gameName: "Rival1", tagLine: "EUW", team: 2, championId: 238, isMe: false },
    { puuid: "y2", gameName: "Rival2", tagLine: "EUW", team: 2, championId: 51, isMe: false },
    { puuid: "y3", gameName: "Rival3", tagLine: "EUW", team: 2, championId: 412, isMe: false },
    { puuid: "y4", gameName: "Rival4", tagLine: "EUW", team: 2, championId: 64, isMe: false },
    { puuid: "y5", gameName: "Rival5", tagLine: "EUW", team: 2, championId: 875, isMe: false },
  ],
};

/**
 * Rangs d'exemple pour l'apercu. « y5 » est volontairement absent et « y4 » sans rang
 * classe : l'apercu montre ainsi les trois etats, y compris ceux qu'on ne connait pas.
 */
export const EXAMPLE_RANKS: PlayerRanksDto[] = [
  { riotId: "Exemple#EUW", puuid: "x1", ranks: [{ queue: "RANKED_SOLO_5x5", tier: "MASTER", division: null, lp: 60, wins: 197, losses: 176 }] },
  { riotId: "Allie1#EUW", puuid: "x2", ranks: [{ queue: "RANKED_SOLO_5x5", tier: "DIAMOND", division: "I", lp: 42, wins: 88, losses: 71 }] },
  { riotId: "Allie2#EUW", puuid: "x3", ranks: [{ queue: "RANKED_SOLO_5x5", tier: "EMERALD", division: "II", lp: 14, wins: 55, losses: 50 }] },
  { riotId: "Allie3#EUW", puuid: "x4", ranks: [{ queue: "RANKED_SOLO_5x5", tier: "DIAMOND", division: "IV", lp: 7, wins: 120, losses: 118 }] },
  { riotId: "Allie4#EUW", puuid: "x5", ranks: [{ queue: "RANKED_SOLO_5x5", tier: "PLATINUM", division: "I", lp: 73, wins: 31, losses: 24 }] },
  { riotId: "Rival1#EUW", puuid: "y1", ranks: [{ queue: "RANKED_SOLO_5x5", tier: "GRANDMASTER", division: null, lp: 412, wins: 310, losses: 264 }] },
  { riotId: "Rival2#EUW", puuid: "y2", ranks: [{ queue: "RANKED_SOLO_5x5", tier: "MASTER", division: null, lp: 128, wins: 204, losses: 181 }] },
  { riotId: "Rival3#EUW", puuid: "y3", ranks: [{ queue: "RANKED_SOLO_5x5", tier: "DIAMOND", division: "III", lp: 55, wins: 76, losses: 70 }] },
  { riotId: "Rival4#EUW", puuid: "y4", ranks: [{ queue: "RANKED_FLEX_SR", tier: "GOLD", division: "II", lp: 20, wins: 12, losses: 9 }] },
];
