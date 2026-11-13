import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { RouteId } from "./routes";

export interface Location {
  route: RouteId;
  /** Parametres simples et serialisables (ex. Riot ID recherche). */
  params?: Record<string, string>;
}

interface NavState {
  stack: Location[];
  index: number;
}

interface NavApi {
  location: Location;
  navigate: (route: RouteId, params?: Record<string, string>) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
}

const NavContext = createContext<NavApi | null>(null);
const MAX_HISTORY = 50;

function sameLocation(a: Location, b: Location) {
  return a.route === b.route && JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {});
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavState>({ stack: [{ route: "dashboard" }], index: 0 });

  const navigate = useCallback((route: RouteId, params?: Record<string, string>) => {
    setState((s) => {
      const next: Location = { route, params };
      if (sameLocation(s.stack[s.index], next)) return s;
      const stack = [...s.stack.slice(0, s.index + 1), next].slice(-MAX_HISTORY);
      return { stack, index: stack.length - 1 };
    });
  }, []);
  const back = useCallback(() => setState((s) => (s.index > 0 ? { ...s, index: s.index - 1 } : s)), []);
  const forward = useCallback(
    () => setState((s) => (s.index < s.stack.length - 1 ? { ...s, index: s.index + 1 } : s)),
    [],
  );

  // Alt+Fleches et boutons lateraux de la souris.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowLeft") back();
      if (e.altKey && e.key === "ArrowRight") forward();
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) back();
      if (e.button === 4) forward();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [back, forward]);

  const api = useMemo<NavApi>(
    () => ({
      location: state.stack[state.index],
      navigate,
      back,
      forward,
      canBack: state.index > 0,
      canForward: state.index < state.stack.length - 1,
    }),
    [state, navigate, back, forward],
  );
  return <NavContext.Provider value={api}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav hors NavigationProvider");
  return ctx;
}
