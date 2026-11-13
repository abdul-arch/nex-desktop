import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/components.css";
import "./styles/dashboard.css";
import "./styles/settings.css";
import "./styles/profile.css";
import "./styles/stats.css";
import "./styles/overlay.css";
import "./styles/recordings.css";
import "./styles/explore.css";
import "./styles/mayhem.css";
import "./styles/leaderboards.css";
import App from "./App";
import { OverlayApp } from "./overlay/OverlayApp";
import { platform } from "./platform";

// Bloque le menu contextuel natif de la WebView (sauf champs de saisie).
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea")) e.preventDefault();
});

// Une seule base de code, deux interfaces : la fenetre "overlay" charge uniquement les widgets.
// (?overlay permet l'apercu dans un navigateur pendant le developpement.)
const isOverlay = platform.windowLabel === "overlay" || (import.meta.env.DEV && new URLSearchParams(location.search).has("overlay"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isOverlay ? <OverlayApp /> : <App />}</React.StrictMode>,
);
