import type { WidgetId } from "../../platform/api";

/** Fiche de chaque widget : source, frequence, transformation, comportement si absent. */
export const WIDGET_INFO: Record<WidgetId, { name: string; source: string; frequency: string; transform: string; missing: string }> = {
  gold: {
    name: "Or des équipes",
    source: "Live Client Data (CS, éliminations, assistances et poste des dix joueurs)",
    frequency: "Recalculé à chaque instantané, toutes les 2 s",
    transform:
      "L'API locale ne publie que ton or. Les totaux sont donc estimés : or de départ + or passif (2,04/s dès 1:50) + or de farm (20/sbire, 28/monstre en jungle) + 300/élimination + 150/assistance. Ne sont pas comptés : primes, plaques, tourelles, objectifs, objets revendus et or passif des objets.",
    missing:
      "Masqué hors partie et en spectateur. Les totaux portent un « ≈ » ; l'écart central est plus fiable, l'or de départ et l'or passif s'annulant entre les deux équipes.",
  },
  winprob: {
    name: "Probabilité de victoire",
    source: "Grille observée par NEX (backend) + écart d'or estimé de la partie en cours",
    frequency: "Grille chargée une fois par partie ; case relue à chaque instantané",
    transform:
      "Ce n'est pas un modèle : NEX compte, sur les parties qu'il a collectées, la part des situations suivies d'une victoire, par tranche de 5 minutes et par millier d'or d'écart. La case affichée est celle de ta tranche et de ton écart d'or estimé.",
    missing:
      "Aucun chiffre si la case compte moins de 60 situations observées, ni avant 2:30 ou après 37:30. Aucun repli sur une case voisine. Deux réserves : l'écart d'or est estimé (cf. Or des équipes), et les parties collectées sont des classées Master et au-dessus.",
  },
  clock: {
    name: "Chronomètre et stats",
    source: "Live Client Data (gameTime, scores du joueur)",
    frequency: "Instantané toutes les 2 s, chronomètre interpolé à la seconde",
    transform: "CS/min = CS / minutes de jeu ; KDA = (É + A) / max(1, M)",
    missing: "« En attente de partie » ; aucune valeur inventée",
  },
  objectives: {
    name: "Timers d'objectifs",
    source: "Live Client Data (événements DragonKill, BaronKill annoncés à tous)",
    frequency: "Recalculé à chaque instantané",
    transform: "Premier dragon 5:00 ; réapparitions : dragon +5:00, Ancien +6:00, baron +6:00 après l'événement",
    missing: "Aucun minuteur affiché sans événement vérifiable",
  },
  build: {
    name: "Prochain objet",
    source: "Build observé NEX (backend) pour ton champion + inventaire visible",
    frequency: "Build chargé une fois par partie ; inventaire toutes les 2 s",
    transform: "Premier objet du build principal pas encore possédé",
    missing: "Masqué si le champion n'a pas assez de parties collectées",
  },
  skills: {
    name: "Rappel de compétence",
    source: "Live Client Data (niveau, rangs des compétences) + priorité observée",
    frequency: "Toutes les 2 s",
    transform: "Points libres = niveau − somme des rangs ; R proposé aux niveaux 6/11/16",
    missing: "Masqué quand aucun point n'est à placer",
  },
  trinket: {
    name: "Rappel de trinket",
    source: "Live Client Data (objet en emplacement 7, niveau)",
    frequency: "Toutes les 2 s",
    transform: "Rappel au niveau 9+ si le totem invisible est encore équipé",
    missing: "Masqué sinon (désactivé par défaut)",
  },
};
