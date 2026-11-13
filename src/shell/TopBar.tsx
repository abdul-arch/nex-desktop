import { ChevronLeft, ChevronRight, Copy, Minus, RotateCw, Search, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "../app/AppState";
import { STAGE_LABEL, useClient } from "../app/ClientContext";
import { useNav } from "../app/navigation";
import { platform } from "../platform";
import { Tip } from "../ui/primitives";

export function TopBar({ onSearch, onRefresh }: { onSearch: () => void; onRefresh: () => void }) {
  const { back, forward, canBack, canForward, navigate } = useNav();
  const client = useClient();
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    platform.captureStatus().then((s) => setRecording(s.active)).catch(() => {});
    const off = platform.on<{ active: boolean }>("capture://status", (s) => setRecording(s.active));
    return () => {
      off.then((o) => o());
    };
  }, []);
  // Etat du backend NEX affiche en permanence (pastille "Backend").
  const { settings, backend, refreshBackend } = useAppState();
  const [maximized, setMaximized] = useState(false);
  const caps = platform.capabilities;

  useEffect(() => {
    if (!caps.windowControls) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    const w = platform.window;
    (async () => {
      setMaximized(await w.isMaximized());
      const off = await w.onResized(async () => setMaximized(await w.isMaximized()));
      if (alive) unlisten = off;
      else off();
    })().catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [caps.windowControls]);

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="nav-arrows">
        <button className="icon-btn" onClick={back} disabled={!canBack} aria-label="Précédent (Alt+←)">
          <ChevronLeft />
        </button>
        <button className="icon-btn" onClick={forward} disabled={!canForward} aria-label="Suivant (Alt+→)">
          <ChevronRight />
        </button>
        <button className="icon-btn" onClick={onRefresh} aria-label="Actualiser la page (F5)">
          <RotateCw />
        </button>
      </div>

      <button className="search-trigger" onClick={onSearch} aria-label="Rechercher (Ctrl+K)">
        <Search aria-hidden="true" />
        <span className="grow">Rechercher un joueur, un champion, une page…</span>
        <kbd>Ctrl</kbd>
        <kbd>K</kbd>
      </button>

      <div className="topbar-drag" data-tauri-drag-region />

      {recording && (
        <button className="rec-live" onClick={() => navigate("recordings")} aria-label="Capture en cours : ouvrir les enregistrements">
          ● REC
        </button>
      )}

      {settings.demoMode && (
        <Tip text="Mode démonstration actif : le dashboard affiche des statistiques fictives. Les profils recherchés restent réels." placement="bottom" align="end">
          <span className="demo-pill" tabIndex={0}>
            MODE DÉMO
          </span>
        </Tip>
      )}

      <Tip
        placement="bottom"
        align="end"
        text={
          !backend
            ? "Vérification du backend NEX…"
            : backend.reachable
              ? backend.riotKeyConfigured
                ? `Backend NEX v${backend.version} joignable, clé Riot configurée.`
                : "Backend joignable mais sans clé Riot (backend/.env)."
              : `Backend NEX injoignable : ${backend.error ?? ""}`
        }
      >
        <button className="client-status" onClick={() => void refreshBackend()} aria-label="État du backend NEX (cliquer pour revérifier)">
          <span className="status-dot" data-state={!backend ? "off" : backend.reachable && backend.riotKeyConfigured ? "ok" : "warn"} />
          Backend
        </button>
      </Tip>

      <Tip
        placement="bottom"
        align="end"
        text={
          !caps.localClient
            ? "Version web : aucune connexion au client local."
            : client.state?.status === "connected"
              ? `Client League connecté${client.state.summoner ? ` (${client.state.summoner.gameName}#${client.state.summoner.tagLine})` : ""} : ${STAGE_LABEL[client.state.stage] ?? client.state.stage}.`
              : "Client League non détecté. NEX le recherche toutes les 10 s."
        }
      >
        <button className="client-status" onClick={() => navigate("live")} aria-label="Partie en direct">
          <span className="status-dot" data-state={client.state?.status === "connected" ? (client.state.stage === "in_game" ? "warn" : "ok") : "off"} />
          {client.state?.status === "connected" ? STAGE_LABEL[client.state.stage] ?? "Client connecté" : "Client : non connecté"}
        </button>
      </Tip>

      {caps.windowControls && (
        <div className="win-controls">
          <button className="win-btn" onClick={() => platform.window.minimize()} aria-label="Réduire">
            <Minus />
          </button>
          <button className="win-btn" onClick={() => platform.window.toggleMaximize()} aria-label={maximized ? "Restaurer" : "Agrandir"}>
            {maximized ? <Copy style={{ transform: "scaleX(-1)" }} /> : <Square />}
          </button>
          <button className="win-btn close" onClick={() => platform.window.close()} aria-label="Fermer">
            <X />
          </button>
        </div>
      )}
    </header>
  );
}
