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
import "./styles/intro.css";
import App from "./App";

// Bloque le menu contextuel natif de la WebView (sauf champs de saisie).
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea")) e.preventDefault();
});

// La fenetre d'overlay a sa propre entree (overlay.html) : elle ne passe plus par ici, et
// n'embarque donc plus les pages de l'application. Apercu navigateur : /overlay.html.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
