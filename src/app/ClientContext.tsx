// Etat du client League local, pousse par le noyau Rust (evenements) : aucune requete
// periodique cote interface.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { platform } from "../platform";
import type { ChampSelectState, ClientState, LiveSnapshot } from "../platform/api";

interface ClientApi {
  state: ClientState | null;
  champSelect: ChampSelectState | null;
  live: LiveSnapshot | null;
  /** Instant (performance.now) de reception du dernier instantane, pour interpoler le chrono. */
  liveAt: number;
}

const Ctx = createContext<ClientApi>({ state: null, champSelect: null, live: null, liveAt: 0 });

export function ClientProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ClientState | null>(null);
  const [champSelect, setChampSelect] = useState<ChampSelectState | null>(null);
  const [live, setLive] = useState<{ s: LiveSnapshot | null; at: number }>({ s: null, at: 0 });

  useEffect(() => {
    let alive = true;
    const offs: (() => void)[] = [];
    (async () => {
      const [s, c, l] = await Promise.all([
        platform.clientState().catch(() => null),
        platform.champSelect().catch(() => null),
        platform.liveSnapshot().catch(() => null),
      ]);
      if (!alive) return;
      setState(s);
      setChampSelect(c);
      setLive({ s: l, at: performance.now() });
      offs.push(await platform.on<ClientState>("client://state", (p) => setState(p)));
      offs.push(await platform.on<ChampSelectState | null>("client://champselect", (p) => setChampSelect(p)));
      offs.push(await platform.on<LiveSnapshot | null>("live://snapshot", (p) => setLive({ s: p, at: performance.now() })));
      if (!alive) offs.forEach((o) => o());
    })();
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, []);

  return <Ctx.Provider value={{ state, champSelect, live: live.s, liveAt: live.at }}>{children}</Ctx.Provider>;
}

export function useClient() {
  return useContext(Ctx);
}

export const STAGE_LABEL: Record<string, string> = {
  absent: "Client fermé",
  home: "Accueil",
  lobby: "Salon",
  matchmaking: "Recherche de partie",
  champ_select: "Sélection des champions",
  loading: "Chargement",
  in_game: "En partie",
  post_game: "Après-partie",
  reconnect: "Reconnexion",
};
