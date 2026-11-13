import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_SETTINGS,
  errorMessage,
  platform,
  type AppInfo,
  type BackendStatus,
  type Catalog,
  type SavedPlayer,
  type SettingKey,
  type Settings,
  type StaticDataVersion,
} from "../platform";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

interface AppStateApi {
  ready: boolean;
  info: AppInfo | null;
  settings: Settings;
  setSetting: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<void>;
  staticData: StaticDataVersion | null;
  staticDataError: string | null;
  favorites: SavedPlayer[];
  recent: SavedPlayer[];
  toggleFavorite: (riotId: string, platform: string) => Promise<void>;
  removeFavorite: (id: number) => Promise<void>;
  pushRecent: (riotId: string, platform: string) => Promise<void>;
  clearRecent: () => Promise<void>;
  toasts: Toast[];
  notify: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  catalog: Catalog | null;
  backend: BackendStatus | null;
  refreshBackend: () => Promise<BackendStatus>;
}

const Ctx = createContext<AppStateApi | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [staticData, setStaticData] = useState<StaticDataVersion | null>(null);
  const [staticDataError, setStaticDataError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<SavedPlayer[]>([]);
  const [recent, setRecent] = useState<SavedPlayer[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [backend, setBackend] = useState<BackendStatus | null>(null);
  const toastId = useRef(0);

  const refreshBackend = useCallback(async () => {
    try {
      const s = await platform.backendHealth();
      setBackend(s);
      return s;
    } catch (e) {
      const s: BackendStatus = { url: "", reachable: false, riotKeyConfigured: false, version: null, error: errorMessage(e) };
      setBackend(s);
      return s;
    }
  }, []);
  useEffect(() => {
    void refreshBackend();
  }, [refreshBackend]);

  const notify = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const results = await Promise.allSettled([
        platform.appInfo(),
        platform.getSettings(),
        platform.listFavorites(),
        platform.listRecentSearches(),
      ]);
      if (!alive) return;
      const [i, s, f, r] = results;
      if (i.status === "fulfilled") setInfo(i.value);
      if (s.status === "fulfilled") setSettings(s.value);
      else notify(`Préférences indisponibles : ${errorMessage(s.reason)}`, "error");
      if (f.status === "fulfilled") setFavorites(f.value);
      if (r.status === "fulfilled") setRecent(r.value);
      setReady(true);
    })();
    platform
      .staticDataVersion()
      .then((v) => alive && setStaticData(v))
      .catch((e) => alive && setStaticDataError(errorMessage(e)));
    // Catalogue compact (noms d'objets, sorts, runes) : charge une fois, en arriere-plan.
    platform
      .staticCatalog()
      .then((c) => alive && setCatalog(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [notify]);

  const setSetting = useCallback(
    async <K extends SettingKey>(key: K, value: Settings[K]) => {
      const previous = settings;
      setSettings({ ...settings, [key]: value });
      try {
        setSettings(await platform.setSetting(key, value));
      } catch (e) {
        setSettings(previous);
        notify(`Réglage refusé : ${errorMessage(e)}`, "error");
      }
    },
    [settings, notify],
  );

  const toggleFavorite = useCallback(
    async (riotId: string, plat: string) => {
      try {
        const existing = favorites.find(
          (p) => `${p.gameName}#${p.tagLine}`.toLowerCase() === riotId.toLowerCase() && p.platform === plat,
        );
        if (existing) {
          setFavorites(await platform.removeFavorite(existing.id));
          notify("Retiré des favoris");
        } else {
          setFavorites(await platform.addFavorite(riotId, plat));
          notify("Ajouté aux favoris", "success");
        }
      } catch (e) {
        notify(errorMessage(e), "error");
      }
    },
    [favorites, notify],
  );

  const removeFavorite = useCallback(
    async (id: number) => {
      try {
        setFavorites(await platform.removeFavorite(id));
      } catch (e) {
        notify(errorMessage(e), "error");
      }
    },
    [notify],
  );

  const pushRecent = useCallback(
    async (riotId: string, plat: string) => {
      try {
        setRecent(await platform.pushRecentSearch(riotId, plat));
      } catch (e) {
        notify(errorMessage(e), "error");
      }
    },
    [notify],
  );

  const clearRecent = useCallback(async () => {
    try {
      await platform.clearRecentSearches();
      setRecent([]);
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }, [notify]);

  const api = useMemo<AppStateApi>(
    () => ({
      ready,
      info,
      settings,
      setSetting,
      staticData,
      staticDataError,
      favorites,
      recent,
      toggleFavorite,
      removeFavorite,
      pushRecent,
      clearRecent,
      toasts,
      notify,
      dismissToast,
      catalog,
      backend,
      refreshBackend,
    }),
    [ready, info, settings, setSetting, staticData, staticDataError, favorites, recent, toggleFavorite, removeFavorite, pushRecent, clearRecent, toasts, notify, dismissToast, catalog, backend, refreshBackend],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState hors AppStateProvider");
  return ctx;
}

/** Version Data Dragon courante (null tant qu'inconnue). */
export function useDDragonVersion(): string | null {
  return useAppState().staticData?.version ?? null;
}
