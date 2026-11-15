// Entree de la fenetre d'overlay, separee de celle de l'application.
//
// POURQUOI UNE ENTREE A PART : les deux fenetres partageaient `index.html`, et la fenetre
// transparente chargeait donc toute l'application — les pages Tableau de bord, Profil,
// Classements, Collection, Data Studio et leurs quatorze feuilles de style — pour dessiner
// quelques widgets. Elle vit pendant la partie, c'est le moment ou il faut lui en demander
// le moins. Mesure du besoin reel : 61 des 71 classes citees par l'arbre de l'overlay sont
// dans `overlay.css`, les autres (`muted`, `num`) viennent de `base.css`. D'ou ces trois
// feuilles au lieu de quatorze.
//
// L'apercu navigateur se fait sur /overlay.html, et non plus sur `?overlay`.
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/overlay.css";
import { OverlayApp } from "./overlay/OverlayApp";

// Bloque le menu contextuel natif de la WebView (l'overlay n'a aucun champ de saisie).
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>,
);
