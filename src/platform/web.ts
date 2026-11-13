// Adaptateur web (site NEX ou apercu navigateur pendant le developpement).
// Pas de client local, pas de fenetre native ; preferences en memoire + localStorage.
import { parseRiotId } from "../domain/riotId";
import { DEFAULT_SETTINGS, type Platform, type SavedPlayer, type Settings } from "./contracts";
import type {
  LeaderboardDto,
  LiveGameDto,
  RankSnapshotDto,
  BaselinesDto,
  IconsDto,
  ProTeamsDto,
  Catalog,
  ChampionBuildDto,
  ChampionInfo,
  MatchDto,
  MatchPageDto,
  MatchupsDto,
  PlayerProfileDto,
  StatsMetaDto,
  TierListDto,
  TimelineDto,
  WidgetLayout,
  MayhemCatalog,
  MayhemDataset,
  MayhemRateResult,
  MayhemRulesInfo,
} from "./api";

/** Equivalent web de la commande Rust : texte brut, balises retirees via DOMParser (jamais injecte). */
async function webChampionInfo(key: string): Promise<ChampionInfo> {
  if (!/^[A-Za-z0-9]{1,32}$/.test(key)) throw { code: "invalid_input", message: "clé de champion invalide" };
  const versions = (await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json()) as string[];
  const v = versions[0];
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/champion/${key}.json`);
  if (!res.ok) throw { code: "not_found", message: `champion inconnu : ${key}` };
  const c = (await res.json()).data[key];
  const text = (html: string) =>
    (new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n"), "text/html").body.textContent ?? "").trim();
  const spell = (s: { name: string; description: string; cooldownBurn?: string; costBurn?: string; image: { full: string } }) => ({
    name: s.name,
    description: text(s.description),
    cooldown: s.cooldownBurn ?? "",
    cost: s.costBurn ?? "",
    image: /^[A-Za-z0-9_.-]+\.png$/.test(s.image.full) ? s.image.full : "",
  });
  return {
    version: v,
    key: c.id,
    id: Number(c.key),
    name: c.name,
    title: c.title,
    tags: c.tags,
    ratings: [c.info.attack, c.info.defense, c.info.magic, c.info.difficulty],
    resource: c.partype,
    blurb: text(c.blurb),
    passive: spell(c.passive),
    spells: c.spells.map(spell),
    skins: c.skins.map((s: { num: number; name: string; chromas: boolean }) => ({ num: s.num, name: s.name, chromas: !!s.chromas })),
  };
}

const KEY = "nex.web.v1";

// Base du backend pour le web : en developpement, proxy Vite (/nex-api -> 127.0.0.1:8787).
// Un site deploye devra pointer vers un backend HTTPS avec CORS et limites par client.
const API_BASE = import.meta.env.DEV ? "/nex-api" : null;

const webUnavailable = {
  code: "unavailable" as const,
  message: "Version web : aucun backend NEX configuré pour le site.",
};

async function api<T>(segments: string[], query: Record<string, string | number | undefined> = {}, body?: unknown): Promise<T> {
  if (!API_BASE) throw webUnavailable;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${API_BASE}/${segments.map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw { code: "unavailable", message: "backend NEX injoignable (cargo run -p nex-backend)" };
  }
  const text = await res.text();
  if (!res.ok) {
    let e: { code?: string; message?: string } | null = null;
    try {
      e = JSON.parse(text);
    } catch {
      /* corps non JSON */
    }
    if (e?.code) throw { code: e.code === "upstream" ? "unavailable" : e.code, message: e.message ?? "" };
    throw { code: "unavailable", message: `backend NEX injoignable ou en erreur (${res.status})` };
  }
  return JSON.parse(text) as T;
}

async function webCatalog(): Promise<Catalog> {
  const dd = "https://ddragon.leagueoflegends.com/cdn";
  const versions = (await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json()) as string[];
  const v = versions[0];
  const get = async (f: string) => (await fetch(`${dd}/${v}/data/fr_FR/${f}`)).json();
  const [c, i, s, r] = await Promise.all([get("champion.json"), get("item.json"), get("summoner.json"), get("runesReforged.json")]);
  const cat: Catalog = { version: v, lang: "fr_FR", champions: {}, items: {}, spells: {}, runes: {} };
  for (const ch of Object.values(c.data) as { id: string; key: string; name: string; tags: string[]; info: { attack: number; magic: number } }[])
    cat.champions[ch.key] = { key: ch.id, name: ch.name, tags: ch.tags ?? [], attack: ch.info?.attack ?? 0, magic: ch.info?.magic ?? 0 };
  for (const [id, it] of Object.entries(i.data) as [string, { name: string; plaintext?: string; gold?: { total: number } }][])
    cat.items[id] = { name: it.name, gold: it.gold?.total ?? 0, plaintext: it.plaintext ?? "" };
  for (const sp of Object.values(s.data) as { id: string; key: string; name: string }[]) cat.spells[sp.key] = { image: sp.id, name: sp.name };
  for (const st of r as { id: number; name: string; icon: string; slots: { runes: { id: number; name: string; icon: string }[] }[] }[]) {
    cat.runes[st.id] = { name: st.name, icon: st.icon, style: st.id };
    for (const ru of st.slots.flatMap((x) => x.runes)) cat.runes[ru.id] = { name: ru.name, icon: ru.icon, style: st.id };
  }
  return cat;
}

interface WebStore {
  settings: Settings;
  favorites: SavedPlayer[];
  recent: SavedPlayer[];
  nextId: number;
}

function load(): WebStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WebStore>;
      return {
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
        favorites: parsed.favorites ?? [],
        recent: parsed.recent ?? [],
        nextId: parsed.nextId ?? 1,
      };
    }
  } catch {
    /* stockage indisponible : on reste en memoire */
  }
  return { settings: { ...DEFAULT_SETTINGS }, favorites: [], recent: [], nextId: 1 };
}

const defaultOverlayLayout = (): WidgetLayout[] => [
  { id: "clock", x: 0.01, y: 0.3, scale: 1, opacity: 0.92, visible: true, locked: false, mode: "always" as const },
  { id: "objectives", x: 0.44, y: 0.015, scale: 1, opacity: 0.92, visible: true, locked: false, mode: "always" as const },
  { id: "build", x: 0.8, y: 0.3, scale: 1, opacity: 0.92, visible: true, locked: false, mode: "always" as const },
  { id: "skills", x: 0.01, y: 0.62, scale: 1, opacity: 0.92, visible: true, locked: false, mode: "always" as const },
  { id: "trinket", x: 0.8, y: 0.55, scale: 1, opacity: 0.92, visible: false, locked: false, mode: "always" as const },
];
let overlayLayout = defaultOverlayLayout();
const desktopOnly = { code: "unavailable", message: "L'assistant ARAM Mayhem nécessite l'application desktop (moteur et lecture locaux)." };

export function createWebPlatform(): Platform {
  const store = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      /* ignore */
    }
  };
  const now = () => Math.floor(Date.now() / 1000);
  const same = (p: SavedPlayer, name: string, tag: string, platform: string) =>
    p.gameName.toLowerCase() === name.toLowerCase() &&
    p.tagLine.toLowerCase() === tag.toLowerCase() &&
    p.platform === platform;

  const validate = (riotId: string) => {
    const r = parseRiotId(riotId);
    if (!r.ok) throw { code: "invalid_input", message: r.error };
    return r.value;
  };

  return {
    capabilities: { kind: "web", windowControls: false, localClient: false, persistentStorage: true },
    appInfo: async () => ({ name: "NEX", version: "web", schemaVersion: 0, debug: true, failedShortcuts: [] }),
    getSettings: async () => ({ ...store.settings }),
    setSetting: async (key, value) => {
      store.settings = { ...store.settings, [key]: value };
      save();
      return { ...store.settings };
    },
    listFavorites: async () => [...store.favorites],
    addFavorite: async (riotId, platform) => {
      const id = validate(riotId);
      if (!store.favorites.some((p) => same(p, id.gameName, id.tagLine, platform))) {
        store.favorites.unshift({ id: store.nextId++, ...id, platform, at: now() });
        save();
      }
      return [...store.favorites];
    },
    removeFavorite: async (id) => {
      store.favorites = store.favorites.filter((p) => p.id !== id);
      save();
      return [...store.favorites];
    },
    listRecentSearches: async () => [...store.recent],
    pushRecentSearch: async (riotId, platform) => {
      const id = validate(riotId);
      store.recent = [
        { id: store.nextId++, ...id, platform, at: now() },
        ...store.recent.filter((p) => !same(p, id.gameName, id.tagLine, platform)),
      ].slice(0, 20);
      save();
      return [...store.recent];
    },
    clearRecentSearches: async () => {
      store.recent = [];
      save();
    },
    staticDataVersion: async () => {
      const res = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
      const list = (await res.json()) as string[];
      return { version: list[0], fetchedAt: now(), source: "network" };
    },
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    // Le site web aura son propre adaptateur HTTP (avec CORS et authentification) ;
    // il n'existe pas encore : on le signale explicitement.
    staticCatalog: webCatalog,
    backendHealth: async () => {
      try {
        const h = await api<{ version: string; riotKeyConfigured: boolean }>(["v1", "health"]);
        return { url: API_BASE ?? "", reachable: true, riotKeyConfigured: h.riotKeyConfigured, version: h.version, error: null };
      } catch (e) {
        return { url: API_BASE ?? "", reachable: false, riotKeyConfigured: false, version: null, error: (e as { message?: string }).message ?? webUnavailable.message };
      }
    },
    playerProfile: async (riotId, plat, refresh = false) => {
      const id = validate(riotId);
      return api<PlayerProfileDto>(["v1", "players", plat, id.gameName, id.tagLine], { refresh: refresh ? "true" : undefined });
    },
    playerMatches: async ({ platform: plat, puuid, start, count, queue, timelines }) =>
      api<MatchPageDto>(["v1", "matches", plat, "by-puuid", puuid], { start, count, queue, timelines }),
    matchGet: async (plat, matchId) => api<MatchDto>(["v1", "match", plat, matchId]),
    matchTimeline: async (plat, matchId) => api<TimelineDto>(["v1", "match", plat, matchId, "timeline"]),
    statsMeta: async () => api<StatsMetaDto>(["v1", "stats", "meta"]),
    statsTierList: async (p) => api<TierListDto>(["v1", "stats", "tierlist"], { ...p }),
    statsBaselines: async (p) => api<BaselinesDto>(["v1", "stats", "baselines"], { ...p }),
    statsIcons: async (p) => api<IconsDto>(["v1", "stats", "icons"], { ...p }),
    statsBuild: async (id, p) => api<ChampionBuildDto>(["v1", "stats", "champion", String(id), "build"], { ...p }),
    statsMatchups: async (id, p) => api<MatchupsDto>(["v1", "stats", "champion", String(id), "matchups"], { ...p }),
    championInfo: async (key) => webChampionInfo(key),
    // Aucun acces au client local depuis un navigateur.
    windowLabel: "web",
    clientState: async () => ({ status: "absent", stage: "absent", phase: "", summoner: null, error: "version web", since: 0 }),
    champSelect: async () => null,
    liveSnapshot: async () => null,
    importRunes: async () => {
      throw { code: "unavailable", message: "L'import vers le client nécessite l'application desktop." };
    },
    importItems: async () => {
      throw { code: "unavailable", message: "L'import vers le client nécessite l'application desktop." };
    },
    overlayOpen: async () => {
      throw { code: "unavailable", message: "Les overlays nécessitent l'application desktop." };
    },
    overlayClose: async () => {},
    overlaySetMode: async () => {},
    // Apercu de developpement : `?overlay&config` ouvre le mode configuration.
    overlayMode: async () => import.meta.env.DEV && new URLSearchParams(location.search).has("config"),
    // Disposition en memoire (miroir de persistence/overlay.rs) : apercu et essais en developpement.
    overlayLayoutGet: async () => overlayLayout.map((w) => ({ ...w })),
    overlayLayoutSet: async (w) => {
      overlayLayout = overlayLayout.map((x) => (x.id === w.id ? { ...w } : x));
      return overlayLayout.map((x) => ({ ...x }));
    },
    overlayLayoutReset: async () => {
      overlayLayout = defaultOverlayLayout();
      return overlayLayout.map((x) => ({ ...x }));
    },
    on: async () => () => {},
    captureStatus: async () => ({
      active: false, source: null, startedAt: null, keepAll: false, framesSent: 0, framesDropped: 0, width: 0, height: 0, fps: 30,
      bufferedSeconds: 0, bufferedMib: 0, encoders: [], error: "La capture nécessite l'application desktop.", finalizing: false,
    }),
    captureSources: async () => [],
    captureStart: async () => {
      throw { code: "unavailable", message: "La capture nécessite l'application desktop." };
    },
    captureStop: async () => {},
    captureSaveClip: async () => {
      throw { code: "unavailable", message: "La capture nécessite l'application desktop." };
    },
    recordingsList: async () => [],
    recordingsStorage: async () => ({ dir: "", usedBytes: 0, quotaBytes: 0, freeBytes: null, count: 0 }),
    recordingSetFavorite: async () => {
      throw { code: "unavailable", message: "Indisponible dans la version web." };
    },
    recordingDelete: async () => {},
    recordingReveal: async () => {},
    assetUrl: () => "",
    skinCatalog: async () => {
      const base = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/fr_fr/v1";
      const [s, l] = await Promise.all([fetch(`${base}/skins.json`).then((r) => r.json()), fetch(`${base}/skinlines.json`).then((r) => r.json())]);
      const rarity = (r: string) =>
        (({ kRare: "rare", kEpic: "epic", kLegendary: "legendary", kMythic: "mythic", kUltimate: "ultimate", kExalted: "exalted", kTranscendent: "transcendent" }) as Record<string, string>)[r] ?? "standard";
      const skins = (Object.values(s) as { id: number; name: string; isBase: boolean; rarity: string; isLegacy: boolean; skinLines?: { id: number }[] | null }[])
        // Skins de champions League uniquement (ids 60 000 000+ = personnages d'autres projets Riot).
        .filter((x) => !x.isBase && x.id >= 1000 && x.id < 1_000_000 && x.id % 1000 !== 0)
        .map((x) => ({ id: x.id, championId: Math.floor(x.id / 1000), num: x.id % 1000, name: x.name, rarity: rarity(x.rarity) as never, legacy: !!x.isLegacy, lines: (x.skinLines ?? []).map((y) => y.id) }));
      const lines: Record<string, string> = {};
      for (const x of l as { id: number; name: string }[]) if (x.id > 0 && x.name) lines[x.id] = x.name;
      return { fetchedAt: Date.now(), skins, lines };
    },
    skinInventory: async () => ({ source: "unknown", fetchedAt: null, owned: [], unobtainable: [], obtainableKnown: false }),
    leaderboard: async (plat, queue, tier, page) => api<LeaderboardDto>(["v1", "leaderboard", plat], { queue, tier, page }),
    liveGame: async (plat, puuid) => api<LiveGameDto>(["v1", "live", plat, puuid]),
    rankHistory: async (plat, puuid, queue = "") => api<RankSnapshotDto[]>(["v1", "ranks", plat, puuid], { queue }),
    proTeams: async () => api<ProTeamsDto>(["v1", "pro", "teams"]),
    spectate: async () => {
      throw { code: "unavailable", message: "Le mode spectateur nécessite l'application desktop." };
    },
    observableFriends: async () => [],
    localMayhemMatches: async () => [],
    // Assistant ARAM Mayhem : meme moteur Rust, execute par le backend NEX (regles publiees
    // uniquement). Lecture d'ecran, overlay et edition locale : application desktop.
    mayhemCatalog: async () => api<MayhemCatalog>(["v1", "mayhem", "catalog"]),
    mayhemRules: async () => api<MayhemRulesInfo>(["v1", "mayhem", "rules"]),
    mayhemSaveRule: async () => {
      throw desktopOnly;
    },
    mayhemDeleteRule: async () => {
      throw desktopOnly;
    },
    mayhemRate: async (req) => api<MayhemRateResult>(["v1", "mayhem", "rate"], {}, req),
    mayhemManual: async () => {
      throw desktopOnly;
    },
    mayhemDemo: async () => null,
    mayhemClear: async () => {},
    mayhemConfirm: async () => [],
    mayhemConfirmed: async () => [],
    mayhemReadNow: async () => {},
    mayhemState: async () => null,
    mayhemDataset: async () => api<MayhemDataset>(["v1", "mayhem", "dataset"]),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      onResized: async () => () => {},
    },
  };
}
