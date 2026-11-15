import {
  Crosshair,
  FileChartColumn,
  Film,
  Gem,
  House,
  LayoutGrid,
  Monitor,
  Radio,
  Settings,
  Sparkles,
  Swords,
  Trophy,
  User,
  type LucideIcon,
} from "lucide-react";

export type RouteId =
  // Accueil du site web : pas d'entree de menu, le bureau n'y va jamais.
  | "accueil"
  | "dashboard"
  | "profile"
  | "champions"
  | "leaderboards"
  | "live"
  | "matchups"
  | "mayhem"
  | "overlays"
  | "recordings"
  | "collection"
  | "spectate"
  | "datastudio"
  | "settings";

export interface RouteDef {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  /** Etape de livraison (cf. docs/ARCHITECTURE.md) ; 1 = disponible maintenant. */
  phase: number;
  /** Propre a l'application de bureau : client League local, fenetre native, capture.
   *  En web, l'adaptateur rend des valeurs neutres et la page s'afficherait VIDE —
   *  ce qui ressemble a une panne. Elle est donc retiree de la navigation. */
  bureau?: true;
}

export const NAV_SECTIONS: { title: string; routes: RouteDef[] }[] = [
  {
    title: "NEX Core",
    routes: [
      { id: "dashboard", label: "Dashboard", icon: House, phase: 1 },
      { id: "profile", label: "Profil & historique", icon: User, phase: 1 },
      { id: "champions", label: "Champions", icon: Swords, phase: 1 },
      { id: "leaderboards", label: "Classements", icon: Trophy, phase: 1 },
    ],
  },
  {
    title: "En jeu",
    routes: [
      { id: "live", label: "Partie en direct", icon: Radio, phase: 1, bureau: true },
      { id: "matchups", label: "Matchups & draft", icon: Crosshair, phase: 1 },
      { id: "mayhem", label: "ARAM Mayhem", icon: Sparkles, phase: 1 },
      { id: "overlays", label: "Overlays", icon: LayoutGrid, phase: 1, bureau: true },
      { id: "recordings", label: "Enregistrements", icon: Film, phase: 1, bureau: true },
    ],
  },
  {
    title: "Explorer",
    routes: [
      { id: "collection", label: "Collection", icon: Gem, phase: 1 },
      { id: "spectate", label: "Spectate", icon: Monitor, phase: 1 },
      { id: "datastudio", label: "Data Studio", icon: FileChartColumn, phase: 1 },
    ],
  },
];

export const SETTINGS_ROUTE: RouteDef = { id: "settings", label: "Paramètres", icon: Settings, phase: 1 };

export const ALL_ROUTES: RouteDef[] = [...NAV_SECTIONS.flatMap((s) => s.routes), SETTINGS_ROUTE];

export function routeDef(id: RouteId): RouteDef {
  return ALL_ROUTES.find((r) => r.id === id) ?? ALL_ROUTES[0];
}
