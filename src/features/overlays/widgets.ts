import type { WidgetId } from "../../platform/api";

/** Fiche de chaque widget : source, frequence, transformation, comportement si absent. */
export const WIDGET_INFO: Record<WidgetId, { name: string; source: string; frequency: string; transform: string; missing: string }> = {
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
