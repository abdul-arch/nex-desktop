// Miroir TypeScript des contrats du backend NEX (crates/nex-domain/src/api.rs).

export interface RankDto {
  queue: string;
  tier: string;
  division: string | null;
  lp: number;
  wins: number;
  losses: number;
}

/**
 * Relevé de rang observé à un instant. Riot ne fournit que le rang courant : l'historique
 * n'existe que parce que NEX enregistre ce qu'il voit, à partir du premier relevé.
 */
export interface RankSnapshotDto {
  /** Instant de l'observation, ms epoch. */
  at: number;
  queue: string;
  tier: string;
  division: string | null;
  lp: number;
  wins: number;
  losses: number;
}

export interface PlayerProfileDto {
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: string;
  level: number;
  profileIconId: number;
  ranks: RankDto[];
  fetchedAt: number;
}

export interface ObjectivesDto {
  champion: number;
  baron: number;
  dragon: number;
  herald: number;
  horde: number;
  tower: number;
  inhibitor: number;
}

export interface TeamDto {
  teamId: number;
  win: boolean;
  bans: number[];
  objectives: ObjectivesDto;
}

export interface ParticipantDto {
  participantId: number;
  puuid: string;
  gameName: string;
  tagLine: string;
  champion: string;
  championId: number;
  championLevel: number;
  teamId: number;
  position: string | null;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  goldEarned: number;
  damageToChampions: number;
  damageTaken: number;
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;
  controlWardsBought: number;
  items: number[];
  spells: number[];
  keystone: number | null;
  primaryStyle: number | null;
  secondaryStyle: number | null;
  perks: number[];
  statPerks: number[];
  soloKills: number | null;
  largestMultiKill: number;
  /** Champs ajoutés après coup : `null` sur une partie normalisée par une version
   *  antérieure, ou lue dans le client League quand il ne la fournit pas. */
  firstBlood: boolean | null;
  /** Temps de contrôle de foule infligé, en secondes. */
  ccTimeSec: number | null;
  damageToObjectives: number | null;
  damageToTurrets: number | null;
  largestKillingSpree: number | null;
  detectorWardsPlaced: number | null;
  /** Temps passé mort, en secondes. */
  timeDeadSec: number | null;
  /** `challenges.turretPlatesTaken` de Riot. Non affiché : la somme des dix joueurs
   *  dépasse le nombre de plaques existantes, ce champ ne compte pas des plaques. */
  turretPlates: number | null;
}

/** Médiane d'une mesure du Data Studio sur les parties collectées par NEX. */
export interface BaselineDto {
  key: string;
  /** null quand aucune partie collectée ne porte cette donnée. */
  median: number | null;
  games: number;
}

/** Une icône d'invocateur et le nombre de joueurs collectés qui la portaient. */
export interface IconDto {
  iconId: number;
  players: number;
  wins: number;
  /** null sous le seuil d'échantillon : un taux sur trois porteurs ne dit rien. */
  winRate: number | null;
}

export interface IconsDto {
  scope: StatsScopeDto;
  sample: number;
  minPlayers: number;
  icons: IconDto[];
}

export interface BaselinesDto {
  /** Poste du repère, chaîne vide pour tous postes confondus. */
  position: string;
  sample: number;
  stats: BaselineDto[];
}

export interface MatchDto {
  id: string;
  platform: string;
  queueId: number;
  queue: "solo" | "flex" | "normal" | "aram" | "arena" | "other";
  gameMode: string;
  gameVersion: string;
  startedAt: number;
  durationSec: number;
  remake: boolean;
  participants: ParticipantDto[];
  teams: TeamDto[];
  goldAt15: number[] | null;
}

export interface MatchPageDto {
  matches: MatchDto[];
  start: number;
  count: number;
  hasMore: boolean;
}

export interface FramePlayerDto {
  participantId: number;
  totalGold: number;
  cs: number;
  xp: number;
  level: number;
}

export interface FrameDto {
  timestamp: number;
  players: FramePlayerDto[];
}

export interface TimelineEventDto {
  timestamp: number;
  kind:
    | "item_purchased"
    | "item_sold"
    | "item_undo"
    | "item_destroyed"
    | "skill_level_up"
    | "champion_kill"
    | "elite_monster_kill"
    | "building_kill";
  participantId?: number;
  itemId?: number;
  beforeItemId?: number;
  skillSlot?: number;
  victimId?: number;
  assistingIds?: number[];
  teamId?: number;
  monsterType?: string;
}

export interface TimelineDto {
  matchId: string;
  frameIntervalMs: number;
  frames: FrameDto[];
  events: TimelineEventDto[];
}

export interface BackendStatus {
  url: string;
  reachable: boolean;
  riotKeyConfigured: boolean;
  version: string | null;
  error: string | null;
}

// ---------- Statistiques agregees (etape 3) ----------

export interface StatsScopeDto {
  patch: string;
  platform: string;
  queueId: number;
  tier: string;
  matches: number;
}

export interface CollectorStatusDto {
  enabled: boolean;
  platforms: string[];
  matchesTotal: number;
  lastIngestedAt: number | null;
  lastError: string | null;
}

export interface StatsMetaDto {
  patches: [string, number][];
  platforms: [string, number][];
  tiers: [string, number][];
  collector: CollectorStatusDto;
  minGames: number;
}

export interface ChampionStatDto {
  championId: number;
  position: string;
  games: number;
  wins: number;
  pickRate: number;
  banRate: number;
  adjustedWinRate: number;
  tier: string;
}

export interface TierListDto {
  scope: StatsScopeDto;
  champions: ChampionStatDto[];
}

export interface VariantDto {
  ids: number[];
  games: number;
  wins: number;
}

export interface ChampionBuildDto {
  scope: StatsScopeDto;
  championId: number;
  position: string;
  games: number;
  wins: number;
  positions: [string, number][];
  runePages: VariantDto[];
  spells: VariantDto[];
  startItems: VariantDto[];
  coreItems: VariantDto[];
  boots: VariantDto[];
  lateItems: VariantDto[];
  skillPriority: VariantDto[];
  skillStart: VariantDto[];
  timelineGames: number;
}

export interface MatchupDto {
  opponentId: number;
  games: number;
  wins: number;
  winRate: number;
  deltaPp: number;
}

export interface MatchupsDto {
  scope: StatsScopeDto;
  championId: number;
  position: string;
  games: number;
  wins: number;
  averageWinRate: number;
  matchups: MatchupDto[];
}

export interface StatsParams {
  patch?: string;
  platform?: string;
  queue?: number;
  tier?: string;
  position?: string;
}

export interface ChampionSpell {
  name: string;
  description: string;
  cooldown: string;
  cost: string;
  image: string;
}

export interface ChampionInfo {
  version: string;
  key: string;
  id: number;
  name: string;
  title: string;
  tags: string[];
  ratings: [number, number, number, number];
  resource: string;
  blurb: string;
  passive: ChampionSpell;
  spells: ChampionSpell[];
  skins: { num: number; name: string; chromas: boolean }[];
}

// ---------- Client local, partie en direct, overlay (etape 4) ----------

export type ClientStage =
  | "absent"
  | "home"
  | "lobby"
  | "matchmaking"
  | "champ_select"
  | "loading"
  | "in_game"
  | "post_game"
  | "reconnect";

export interface ClientState {
  status: "absent" | "connected";
  stage: ClientStage;
  phase: string;
  summoner: { gameName: string; tagLine: string; platform: string | null; level: number } | null;
  error: string | null;
  since: number;
}

export interface DraftSlotDto {
  cellId: number;
  championId: number;
  intent: boolean;
  position: string | null;
}

export interface ChampSelectState {
  localCell: number;
  myTeam: DraftSlotDto[];
  theirTeam: DraftSlotDto[];
  myBans: number[];
  theirBans: number[];
}

export interface LivePlayer {
  riotId: string;
  championKey: string;
  team: string;
  position: string | null;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  items: number[];
  isDead: boolean;
  respawnTimer: number;
  isActive: boolean;
}

export interface ObjectiveTimer {
  kind: "dragon" | "elder" | "baron";
  nextSpawn: number;
  source: "event" | "first_spawn";
}

export interface LiveSnapshot {
  gameTime: number;
  gameMode: string;
  activeLevel: number;
  abilities: [number, number, number, number];
  unspentPoints: number;
  currentGold: number;
  players: LivePlayer[];
  objectives: ObjectiveTimer[];
}

export type WidgetId = "clock" | "objectives" | "build" | "skills" | "trinket";

export interface WidgetLayout {
  id: WidgetId;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** « always » : affiché toute la partie. « hold » : seulement touche maintenue. */
  mode: "always" | "hold";
}

export interface RunePageInput {
  championName: string;
  primaryStyle: number;
  subStyle: number;
  perks: number[];
  replacePageId?: number | null;
}

export interface ItemSetInput {
  championId: number;
  championName: string;
  role?: string | null;
  blocks: { label: string; items: number[] }[];
}

export interface ImportOutcome {
  status: "done" | "needs_choice";
  verified: boolean;
  message: string;
  pages: { id: number; name: string; current: boolean }[];
}

// ---------- Capture et enregistrements (etape 5) ----------

export interface CaptureStatus {
  active: boolean;
  source: string | null;
  startedAt: number | null;
  keepAll: boolean;
  framesSent: number;
  framesDropped: number;
  width: number;
  height: number;
  fps: number;
  bufferedSeconds: number;
  bufferedMib: number;
  encoders: string[];
  error: string | null;
  finalizing: boolean;
}

export interface Marker {
  tMs: number;
  kind: string;
  label: string;
}

export interface Recording {
  id: number;
  kind: "clip" | "full";
  title: string;
  path: string;
  thumb: string | null;
  championKey: string | null;
  gameMode: string | null;
  kda: string | null;
  durationMs: number;
  sizeBytes: number;
  createdAt: number;
  favorite: boolean;
  markers: Marker[];
  complete: boolean;
}

export interface StorageInfo {
  dir: string;
  usedBytes: number;
  quotaBytes: number;
  freeBytes: number | null;
  count: number;
}

// ---------- Collection, classements, spectate (etape 6) ----------

export type SkinRarity = "standard" | "rare" | "epic" | "legendary" | "mythic" | "ultimate" | "exalted" | "transcendent";

export interface SkinEntry {
  id: number;
  championId: number;
  num: number;
  name: string;
  rarity: SkinRarity;
  legacy: boolean;
  lines: number[];
}

export interface SkinCatalog {
  fetchedAt: number;
  skins: SkinEntry[];
  lines: Record<string, string>;
}

export interface SkinInventory {
  source: "client" | "cache" | "unknown";
  fetchedAt: number | null;
  owned: { id: number; acquiredAt: number | null }[];
  unobtainable: number[];
  obtainableKnown: boolean;
}

export interface LeaderboardEntryDto {
  rank: number;
  puuid: string;
  gameName: string;
  tagLine: string;
  lp: number;
  wins: number;
  losses: number;
  hotStreak: boolean;
  /** Icone d'invocateur ; null si Riot n'a pas repondu. */
  profileIconId?: number | null;
}

/** Equipes pro et comptes classes declares, d'apres Leaguepedia (CC BY-SA). */
export interface ProTeamsDto {
  source: string;
  sourceUrl: string;
  license: string;
  fetchedAt: number;
  teams: ProTeamDto[];
}

export interface ProTeamDto {
  name: string;
  league: string;
  players: ProPlayerDto[];
}

export interface ProPlayerDto {
  name: string;
  role: string;
  residency: string;
  pageUrl: string;
  accounts: { riotId: string; platform: string }[];
  unusableAccounts: number;
}

export interface LeaderboardDto {
  platform: string;
  queue: string;
  tier: string;
  page: number;
  pageSize: number;
  total: number;
  fetchedAt: number;
  entries: LeaderboardEntryDto[];
}

export interface LiveGameDto {
  inGame: boolean;
  gameId: number | null;
  queueId: number | null;
  gameMode: string | null;
  startTime: number | null;
  participants: { puuid: string; riotId: string; championId: number; teamId: number }[];
  fetchedAt: number;
}

export interface Catalog {
  version: string;
  lang: string;
  champions: Record<string, { key: string; name: string; tags: string[]; attack: number; magic: number }>;
  items: Record<string, { name: string; gold: number; plaintext: string }>;
  spells: Record<string, { image: string; name: string }>;
  runes: Record<string, { name: string; icon: string; style: number }>;
}

// ---------- Assistant ARAM Mayhem (miroir de crates/nex-mayhem et src-tauri/src/mayhem) ----------

export type MayhemTier = "S+" | "S" | "A" | "B" | "C" | "D";
export type MayhemRarity = "silver" | "gold" | "prismatic" | "other";
export type MayhemMechanic =
  | "immobilisation"
  | "attaques_de_base"
  | "effets_a_l_impact"
  | "critique"
  | "vitesse_d_attaque"
  | "degats_de_competences"
  | "soins"
  | "boucliers"
  | "mana"
  | "distance"
  | "melee"
  | "resistance"
  | "mobilite";
export type MayhemOrientation = "degats" | "resistance" | "soutien" | "mobilite";
export type MayhemValidation = "fixture" | "local_editorial" | "editorial";
export type MayhemConfidence = "exact" | "approx" | "ambiguous";

export interface MayhemAugment {
  id: number;
  key: string;
  nameEn: string;
  nameFr: string;
  rarity: MayhemRarity;
  icon: string;
}

export interface MayhemCatalog {
  mode: string;
  patch: string;
  fetchedAt: number;
  source: string;
  augments: MayhemAugment[];
}

export interface MayhemAugmentRule {
  key: string;
  base: MayhemTier;
  requires: MayhemMechanic[];
  benefits: MayhemMechanic[];
  orientation: MayhemOrientation[];
  combos: string[];
  conflicts: string[];
  note: string | null;
  validation?: MayhemValidation;
}

export interface MayhemRuleSet {
  version: string;
  engine: number;
  mode: string;
  patch: string;
  reviewedAt: string;
  validation: MayhemValidation;
  augments: MayhemAugmentRule[];
}

export interface MayhemRulesInfo {
  editorial: MayhemRuleSet;
  local: MayhemAugmentRule[];
}

export interface MayhemRating {
  key: string | null;
  tier: MayhemTier | null;
  score: number | null;
  status: "rated" | "not_evaluated" | "unknown";
  reasons: { text: string; delta: number }[];
  validation: MayhemValidation | null;
  engine: number;
  rulesVersion: string | null;
}

export interface MayhemProfile {
  key: string;
  mechanics: Partial<Record<MayhemMechanic, number>>;
  source: "data_dragon_heuristic" | "editorial";
}

export interface MayhemRateResult {
  ratings: MayhemRating[];
  best: number | null;
  profile: MayhemProfile | null;
  rulesVersion: string;
  /** Contexte par carte (popularite, combos) : informatif, jamais utilise pour la note. */
  context: MayhemCardContext[];
}

// ---------- Donnees publiques arammayhem.com (CC BY 4.0) ----------

export interface MayhemCapabilities {
  catalog: boolean;
  popularity: boolean;
  globalTiers: boolean;
  championAugmentTiers: boolean;
  builds: boolean;
  combos: boolean;
  history: boolean;
}

export interface MayhemProvenance {
  provider: string;
  url: string;
  mode: string;
  patch: string | null;
  patchReleaseDate: string | null;
  statsDate: string | null;
  statsDateSource: string | null;
  comparedToPatch: string | null;
  releaseId: string | null;
  fetchedAt: number;
  scope: string | null;
  license: string;
  licenseUrl: string;
  attribution: string;
  attributionUrl: string;
  dataSource: string | null;
}

export interface MayhemAugmentStat {
  providerId: string;
  nexKey: string | null;
  mapping: "exact" | "alias" | "ambiguous" | "unmapped";
  nameEn: string;
  rarity: string | null;
  introducedPatch: string | null;
  retiredPatch: string | null;
  pickRate: number | null;
  pickRateRank: number | null;
  previousPickRate: number | null;
  pickRateChange: number | null;
  pickRateRankChange: number | null;
  presence: string | null;
  url: string | null;
}

export interface MayhemChampionStat {
  championId: string;
  nameEn: string;
  pickRate: number | null;
  pickRateRank: number | null;
  pickRateChange: number | null;
  pickRateRankChange: number | null;
  url: string | null;
}

export interface MayhemCombo {
  comboId: number;
  championId: string;
  augmentIds: string[];
  types: string[];
  url: string | null;
  /** Tous les augments sont relies au catalogue Riot du patch : combo tirable aujourd'hui. */
  inPool: boolean;
}

export interface MayhemDataset {
  provenance: MayhemProvenance;
  capabilities: MayhemCapabilities;
  augments: MayhemAugmentStat[];
  champions: MayhemChampionStat[];
  combos: MayhemCombo[];
  anomalies: string[];
}

export interface MayhemComboNote {
  comboId: number;
  status: "active" | "project";
  /** Nombre d'augments du combo (1 : cet augment seul est documente pour le champion). */
  size: number;
  missing: string[];
  types: string[];
  needsVerification: boolean;
  url: string | null;
}

export interface MayhemCardContext {
  popularity: {
    pickRate: number | null;
    pickRateRank: number | null;
    rankScope: number;
    pickRateChange: number | null;
    presence: string | null;
    retiredPatch: string | null;
    patch: string | null;
    statsDate: string | null;
    statsDateSource: string | null;
    url: string | null;
    attribution: string;
  } | null;
  /** Combos tries : realisables, a verifier, puis projets (12 au plus). */
  combos: MayhemComboNote[];
  /** Nombre total de combos documentes pour ce champion et cet augment (pool actuel). */
  combosTotal: number;
  /** Combos masques : un augment absent du patch actuel ou non relie au catalogue. */
  combosOutsidePool: number;
}

export interface MayhemRateRequest {
  champion: string | null;
  offered: (string | null)[];
  confirmed: string[];
  orientation: MayhemOrientation | null;
}

export interface MayhemCardView {
  slot: number;
  key: string | null;
  name: string | null;
  rarity: MayhemRarity | null;
  text: string;
  confidence: MayhemConfidence | null;
  /** Rectangle du titre [x, y, w, h] en fractions de la zone client du jeu. */
  rect: [number, number, number, number] | null;
}

/** Evenement `mayhem://cards` (null = badges retires). */
export interface MayhemCardsEvent {
  version: number;
  phase: number;
  source: "screen_reading" | "manual" | "demo";
  demo: boolean;
  game: { x: number; y: number; w: number; h: number } | null;
  champion: string | null;
  cards: MayhemCardView[];
  ratings: MayhemRating[];
  best: number | null;
  rulesVersion: string;
  context: MayhemCardContext[];
  at: number;
  readMs: number | null;
}
