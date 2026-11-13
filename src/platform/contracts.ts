// Contrats types entre l'interface et la plateforme (desktop Tauri ou web).
// Les noms et formes doivent rester alignes avec src-tauri/src/commands.rs.

export type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "network"
  | "rate_limited"
  | "storage"
  | "unavailable";

export interface PlatformError {
  code: ErrorCode;
  message: string;
}

export function isPlatformError(e: unknown): e is PlatformError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as PlatformError).code === "string" &&
    typeof (e as PlatformError).message === "string"
  );
}

export function errorMessage(e: unknown): string {
  if (isPlatformError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface AppInfo {
  name: string;
  version: string;
  schemaVersion: number;
  debug: boolean;
}

export interface Settings {
  language: "fr" | "en";
  abilityKeys: "AZER" | "QWER";
  closeBehavior: "tray" | "quit";
  ecoMode: boolean;
  sidebarCollapsed: boolean;
  demoMode: boolean;
  defaultPlatform: string;
  backendUrl: string;
  /** "Pseudo#TAG" ou "" si aucun compte lie. */
  linkedRiotId: string;
  linkedPlatform: string;
  favoriteChampions: number[];
  overlayAuto: boolean;
  replaySeconds: number;
  replayMaxMib: number;
  recordFullGames: boolean;
  autoClips: boolean;
  storageQuotaGib: number;
  favoriteSkins: number[];
  mayhemAuto: boolean;
  mayhemBadges: boolean;
  mayhemOrientation: "" | "degats" | "resistance" | "soutien" | "mobilite";
  /** Dixiemes de hauteur de titre entre le haut du titre et le centre du badge. */
  mayhemBadgeOffset: number;
  mayhemBadgeScale: number;
  mayhemBadgeOpacity: number;
}

export type SettingKey = keyof Settings;

export interface SavedPlayer {
  id: number;
  gameName: string;
  tagLine: string;
  platform: string;
  /** Horodatage Unix en secondes. */
  at: number;
}

export interface StaticDataVersion {
  version: string;
  fetchedAt: number;
  source: "network" | "cache" | "stale-cache";
}

/** Capacites d'acces : le web n'a ni client local, ni fenetres natives. */
export interface PlatformCapabilities {
  kind: "desktop" | "web";
  windowControls: boolean;
  localClient: boolean;
  persistentStorage: boolean;
}

export interface Platform {
  capabilities: PlatformCapabilities;
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<Settings>;
  listFavorites(): Promise<SavedPlayer[]>;
  addFavorite(riotId: string, platform: string): Promise<SavedPlayer[]>;
  removeFavorite(id: number): Promise<SavedPlayer[]>;
  listRecentSearches(): Promise<SavedPlayer[]>;
  pushRecentSearch(riotId: string, platform: string): Promise<SavedPlayer[]>;
  clearRecentSearches(): Promise<void>;
  staticDataVersion(): Promise<StaticDataVersion>;
  staticCatalog(): Promise<Catalog>;
  openExternal(url: string): Promise<void>;
  backendHealth(): Promise<BackendStatus>;
  playerProfile(riotId: string, platform: string, refresh?: boolean): Promise<PlayerProfileDto>;
  playerMatches(args: {
    platform: string;
    puuid: string;
    start?: number;
    count?: number;
    queue?: number;
    timelines?: number;
  }): Promise<MatchPageDto>;
  matchGet(platform: string, matchId: string): Promise<MatchDto>;
  matchTimeline(platform: string, matchId: string): Promise<TimelineDto>;
  statsMeta(): Promise<StatsMetaDto>;
  statsTierList(params: StatsParams): Promise<TierListDto>;
  /**
   * Médianes des mesures du Data Studio sur les parties collectées par NEX.
   * Une mesure qu'aucune partie collectée ne porte rend `median: null`.
   */
  statsBaselines(params: StatsParams): Promise<BaselinesDto>;
  statsBuild(championId: number, params: StatsParams): Promise<ChampionBuildDto>;
  statsMatchups(championId: number, params: StatsParams): Promise<MatchupsDto>;
  championInfo(key: string): Promise<ChampionInfo>;
  /** Libelle de la fenetre courante ("main", "overlay" ou "web"). */
  windowLabel: string;
  clientState(): Promise<ClientState>;
  champSelect(): Promise<ChampSelectState | null>;
  liveSnapshot(): Promise<LiveSnapshot | null>;
  importRunes(input: RunePageInput): Promise<ImportOutcome>;
  importItems(input: ItemSetInput): Promise<ImportOutcome>;
  overlayOpen(config: boolean): Promise<void>;
  overlayClose(): Promise<void>;
  overlaySetMode(config: boolean): Promise<void>;
  overlayMode(): Promise<boolean>;
  overlayLayoutGet(): Promise<WidgetLayout[]>;
  overlayLayoutSet(widget: WidgetLayout): Promise<WidgetLayout[]>;
  overlayLayoutReset(): Promise<WidgetLayout[]>;
  captureStatus(): Promise<CaptureStatus>;
  captureSources(): Promise<string[]>;
  captureStart(source: string, keepAll: boolean): Promise<CaptureStatus>;
  captureStop(): Promise<void>;
  captureSaveClip(seconds: number, title?: string): Promise<Recording>;
  recordingsList(): Promise<Recording[]>;
  recordingsStorage(): Promise<StorageInfo>;
  recordingSetFavorite(id: number, favorite: boolean): Promise<Recording>;
  recordingDelete(id: number): Promise<void>;
  recordingReveal(id: number): Promise<void>;
  skinCatalog(): Promise<SkinCatalog>;
  skinInventory(): Promise<SkinInventory>;
  leaderboard(platform: string, queue: string, tier: string, page: number): Promise<LeaderboardDto>;
  liveGame(platform: string, puuid: string): Promise<LiveGameDto>;
  /**
   * Relevés de rang déjà enregistrés par le backend, du plus ancien au plus récent.
   * Riot ne fournit que le rang courant : cette liste ne contient que ce que NEX a observé,
   * et elle est vide tant qu'aucun relevé n'a été pris. `queue` vide = toutes les files.
   */
  rankHistory(platform: string, puuid: string, queue?: string): Promise<RankSnapshotDto[]>;
  /** Equipes pro et comptes declares (Leaguepedia, collecte du backend, cache 24 h). */
  proTeams(): Promise<ProTeamsDto>;
  /** Ouvre la partie d'un ami (Riot ID) en spectateur dans le client : seul cas accepte par le client. */
  spectate(riotId: string): Promise<void>;
  /** Riot ID (« Pseudo#TAG ») des amis dont la partie peut etre regardee maintenant. */
  observableFriends(): Promise<string[]>;
  /**
   * Parties ARAM Mayhem du compte connecte au client League, les plus recentes d'abord.
   * L'API publique de Riot ne fournit pas ces parties : elles viennent du client local.
   * Liste vide si `riotId` n'est pas le compte du client, ou hors application desktop.
   */
  localMayhemMatches(riotId: string, puuid: string, count?: number): Promise<MatchDto[]>;
  mayhemCatalog(): Promise<MayhemCatalog>;
  mayhemRules(): Promise<MayhemRulesInfo>;
  mayhemSaveRule(rule: MayhemAugmentRule): Promise<MayhemAugmentRule[]>;
  mayhemDeleteRule(key: string): Promise<MayhemAugmentRule[]>;
  mayhemRate(req: MayhemRateRequest): Promise<MayhemRateResult>;
  /** Saisie manuelle (depannage) affichee sur l'overlay, marquee comme telle. */
  mayhemManual(offered: (string | null)[]): Promise<MayhemCardsEvent | null>;
  mayhemDemo(on: boolean): Promise<MayhemCardsEvent | null>;
  mayhemClear(): Promise<void>;
  mayhemConfirm(key: string, chosen: boolean): Promise<string[]>;
  mayhemConfirmed(): Promise<string[]>;
  mayhemReadNow(): Promise<void>;
  mayhemState(): Promise<MayhemCardsEvent | null>;
  /** Donnees publiques arammayhem.com (CC BY 4.0) : popularite, combos, provenance. */
  mayhemDataset(): Promise<MayhemDataset>;
  /** URL lisible par la WebView pour un fichier local autorise (protocole d'assets). */
  assetUrl(path: string): string;
  /** Abonnement a un evenement du noyau ; renvoie la fonction de desabonnement. */
  on<T>(event: string, cb: (payload: T) => void): Promise<() => void>;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    /** Abonnement aux redimensionnements ; renvoie la fonction de desabonnement. */
    onResized(cb: () => void): Promise<() => void>;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  language: "fr",
  abilityKeys: "AZER",
  closeBehavior: "quit",
  ecoMode: true,
  sidebarCollapsed: false,
  demoMode: true,
  defaultPlatform: "EUW1",
  backendUrl: "http://127.0.0.1:8787",
  linkedRiotId: "",
  linkedPlatform: "EUW1",
  favoriteChampions: [],
  overlayAuto: true,
  replaySeconds: 120,
  replayMaxMib: 512,
  recordFullGames: false,
  autoClips: true,
  storageQuotaGib: 20,
  favoriteSkins: [],
  mayhemAuto: true,
  mayhemBadges: true,
  mayhemOrientation: "",
  mayhemBadgeOffset: 118,
  mayhemBadgeScale: 100,
  mayhemBadgeOpacity: 95,
};

import type {
  MayhemDataset,
  MayhemAugmentRule,
  MayhemCardsEvent,
  MayhemCatalog,
  MayhemRateRequest,
  MayhemRateResult,
  MayhemRulesInfo,
  BackendStatus,
  LeaderboardDto,
  LiveGameDto,
  RankSnapshotDto,
  BaselinesDto,
  ProTeamsDto,
  SkinCatalog,
  SkinInventory,
  CaptureStatus,
  Recording,
  StorageInfo,
  Catalog,
  ChampSelectState,
  ClientState,
  ImportOutcome,
  ItemSetInput,
  LiveSnapshot,
  RunePageInput,
  WidgetLayout,
  ChampionBuildDto,
  ChampionInfo,
  MatchDto,
  MatchPageDto,
  MatchupsDto,
  PlayerProfileDto,
  StatsMetaDto,
  StatsParams,
  TierListDto,
  TimelineDto,
} from "./api";
export type * from "./api";
