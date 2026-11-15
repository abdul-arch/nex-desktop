// Coquille du site : barre haute, contenu, pied de page.
//
// Meme charte que l'application, aucune piece de bureau — pas de barre laterale, pas de
// poignee de fenetre, pas de client League. Les pages sont celles de l'application ; ce
// qui change, c'est la navigation, adossee a l'URL : chaque profil, chaque champion a une
// adresse qui se partage et se recharge. Le dessin suit dpm.lol et invade.lol : un logo, une
// recherche en vedette, des cartes de vraies donnees.
import { Download, Search, X } from "lucide-react";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { AppStateProvider, useAppState } from "../app/AppState";
import { ClientProvider } from "../app/ClientContext";
import { NavigationUrlProvider, useNav } from "../app/navigation";
import type { RouteId } from "../app/routes";
import { ChampionsPage } from "../features/champions/ChampionsPage";
import { CollectionPage } from "../features/collection/CollectionPage";
import { DataStudioPage } from "../features/datastudio/DataStudioPage";
import { LeaderboardsPage } from "../features/leaderboards/LeaderboardsPage";
import { MatchupsPage } from "../features/matchups/MatchupsPage";
import { MayhemPage } from "../features/mayhem/MayhemPage";
import { ModulePage } from "../features/modules/ModulePage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { CommandPalette } from "../shell/CommandPalette";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { NexLogo } from "../ui/NexLogo";
import { Accueil, DEPOT_APP } from "./Accueil";
import { locationDepuisUrl, titreDe, urlDepuisLocation } from "./routeur";

const LIENS: { route: RouteId; label: string }[] = [
  { route: "champions", label: "Champions" },
  { route: "leaderboards", label: "Classements" },
  { route: "matchups", label: "Matchups" },
];

export default function WebApp() {
  return (
    <AppStateProvider>
      <ClientProvider>
        <NavigationUrlProvider lire={locationDepuisUrl} ecrire={urlDepuisLocation}>
          <Coquille />
        </NavigationUrlProvider>
      </ClientProvider>
    </AppStateProvider>
  );
}

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

function Coquille() {
  const { location, navigate } = useNav();
  const [palette, setPalette] = useState(false);
  const ouvrir = useCallback(() => setPalette(true), []);
  // Remonter la page courante apres une erreur de rendu : la cle change, la page se remonte.
  const [cle, setCle] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Un site : chaque page remonte en haut et nomme son onglet.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = titreDe(location);
  }, [location]);

  // Les liens sont de vrais liens (clic droit, nouvel onglet), mais un clic simple reste
  // dans l'application au lieu de recharger la page.
  const lien = (route: RouteId) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(route);
  };

  let page;
  switch (location.route) {
    case "accueil":
    case "dashboard":
      page = <Accueil onSearch={ouvrir} />;
      break;
    case "profile":
      page = <ProfilePage onSearch={ouvrir} />;
      break;
    case "champions":
      page = <ChampionsPage />;
      break;
    case "leaderboards":
      page = <LeaderboardsPage />;
      break;
    case "matchups":
      page = <MatchupsPage />;
      break;
    case "collection":
      page = <CollectionPage />;
      break;
    case "mayhem":
      page = <MayhemPage />;
      break;
    case "datastudio":
      page = <DataStudioPage />;
      break;
    case "settings":
      page = <SettingsPage />;
      break;
    default:
      page = <ModulePage id={location.route} />;
  }

  return (
    <div className="site">
      <header className="site-barre">
        <a className="site-marque" href="/" onClick={lien("accueil")}>
          <NexLogo size={26} />
          nex.lol <span>stats</span>
        </a>
        <nav className="site-nav" aria-label="Sections">
          {LIENS.map((l) => (
            <a key={l.route} href={urlDepuisLocation({ route: l.route })} onClick={lien(l.route)} aria-current={location.route === l.route ? "page" : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        <button type="button" className="site-recherche" onClick={ouvrir}>
          <Search size={15} aria-hidden="true" />
          <span>Rechercher un Riot ID, un champion…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <a className="btn btn-primary btn-sm" href={DEPOT_APP} target="_blank" rel="noreferrer" title="L'application Windows : overlay en partie, assistant de draft, clips">
          <Download size={14} aria-hidden="true" /> L'app
        </a>
      </header>

      <main className="site-contenu" key={cle}>
        <ErrorBoundary onReset={() => setCle((k) => k + 1)}>{page}</ErrorBoundary>
      </main>

      <footer className="site-pied">
        <p>
          Les chiffres viennent de l'API Riot et des parties que NEX collecte lui-même ; rien n'est importé d'un autre site. NEX n'est pas
          approuvé par Riot Games.
        </p>
        <p>
          NEX isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or
          managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
        </p>
      </footer>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Toasts />
    </div>
  );
}
