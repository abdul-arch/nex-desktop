import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppStateProvider, useAppState } from "./app/AppState";
import { NavigationProvider, useNav } from "./app/navigation";
import { BuildsPage } from "./features/builds/BuildsPage";
import { ChampionsPage } from "./features/champions/ChampionsPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { MatchupsPage } from "./features/matchups/MatchupsPage";
import { LivePage } from "./features/live/LivePage";
import { OverlaysPage } from "./features/overlays/OverlaysPage";
import { RecordingsPage } from "./features/recordings/RecordingsPage";
import { ClientProvider } from "./app/ClientContext";
import { ModulePage } from "./features/modules/ModulePage";
import { CollectionPage } from "./features/collection/CollectionPage";
import { DataStudioPage } from "./features/datastudio/DataStudioPage";
import { LeaderboardsPage } from "./features/leaderboards/LeaderboardsPage";
import { SpectatePage } from "./features/spectate/SpectatePage";
import { MayhemPage } from "./features/mayhem/MayhemPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { CommandPalette } from "./shell/CommandPalette";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { ALL_ROUTES } from "./app/routes";
import { platform } from "./platform";

function Toasts() {
  const { toasts, dismissToast } = useAppState();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" data-kind={t.kind} key={t.id}>
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Fermer la notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { settings } = useAppState();
  const { location } = useNav();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Incrementer la cle remonte la page courante (bouton Actualiser / F5) et relance ses requetes.
  const [refreshKey, setRefreshKey] = useState(0);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "F5") {
        e.preventDefault();
        refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh]);

  // Mesures (`nex.exe --perf-tour=<s>`) : parcours automatique de toutes les pages avec
  // defilement progressif, sans aucune action d'ecriture. Evenement emis uniquement par Rust.
  const { navigate } = useNav();
  useEffect(() => {
    let stop = false;
    let off: (() => void) | undefined;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    platform
      .on<{ dwellMs: number; rounds: number }>("perf://tour", async ({ dwellMs, rounds }) => {
        for (let r = 0; r < rounds; r++) {
          for (const route of ALL_ROUTES) {
            if (stop) return;
            navigate(route.id);
            await sleep(dwellMs / 2);
            for (let i = 0; i < 6 && !stop; i++) {
              const c = document.querySelector(".content");
              c?.scrollBy({ top: c.clientHeight * 0.9 });
              await sleep(dwellMs / 12);
            }
          }
        }
        navigate("dashboard");
      })
      .then((o) => {
        off = o;
        if (stop) o();
      });
    return () => {
      stop = true;
      off?.();
    };
  }, [navigate]);

  // Remonte en haut de la page a chaque navigation. Les Classements rendent eux-memes leur
  // position de defilement (retour depuis un profil).
  useEffect(() => {
    if (location.route === "leaderboards") return;
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }, [location]);

  let page;
  switch (location.route) {
    case "dashboard":
      page = <DashboardPage />;
      break;
    case "profile":
      page = <ProfilePage onSearch={openPalette} />;
      break;
    case "settings":
      page = <SettingsPage />;
      break;
    case "champions":
      page = <ChampionsPage />;
      break;
    case "builds":
      page = <BuildsPage />;
      break;
    case "matchups":
      page = <MatchupsPage />;
      break;
    case "live":
      page = <LivePage />;
      break;
    case "overlays":
      page = <OverlaysPage />;
      break;
    case "recordings":
      page = <RecordingsPage />;
      break;
    case "collection":
      page = <CollectionPage />;
      break;
    case "leaderboards":
      page = <LeaderboardsPage />;
      break;
    case "spectate":
      page = <SpectatePage />;
      break;
    case "mayhem":
      page = <MayhemPage />;
      break;
    case "datastudio":
      page = <DataStudioPage />;
      break;
    default:
      page = <ModulePage id={location.route} />;
  }

  return (
    <div className="app" data-collapsed={settings.sidebarCollapsed}>
      <Sidebar />
      <div className="main-col">
        <TopBar onSearch={openPalette} onRefresh={refresh} />
        <main className="content" key={`${location.route}-${refreshKey}`}>
          <ErrorBoundary onReset={refresh}>{page}</ErrorBoundary>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <ClientProvider>
        <NavigationProvider>
          <Shell />
        </NavigationProvider>
      </ClientProvider>
    </AppStateProvider>
  );
}
