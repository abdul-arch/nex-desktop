import type { WidgetId } from "../../platform/api";

/** Fiche de chaque widget : source, frequence, transformation, comportement si absent. */
export const WIDGET_INFO: Record<
  WidgetId,
  {
    name: string;
    /** Une ligne orientee usage, affichee sur la carte. Distincte de `transform`,
     *  qui explique le calcul et vit dans le panneau de reglages. */
    summary: string;
    source: string;
    frequency: string;
    transform: string;
    missing: string;
  }
> = {
  gold: {
    name: "Or des équipes",
    summary: "Qui est le plus riche, d'un coup d'œil.",
    source: "Live Client Data (CS, éliminations, assistances et poste des dix joueurs)",
    frequency: "Recalculé à chaque instantané, toutes les 2 s",
    transform:
      "L'API locale ne publie que ton or. Les totaux sont donc estimés : or de départ + or passif (2,04/s dès 1:50) + or de farm (20/sbire, 28/monstre en jungle) + 300/élimination + 150/assistance. Ne sont pas comptés : primes, plaques, tourelles, objectifs, objets revendus et or passif des objets.",
    missing:
      "Masqué hors partie et en spectateur. Les totaux portent un « ≈ » ; l'écart central est plus fiable, l'or de départ et l'or passif s'annulant entre les deux équipes.",
  },
  winprob: {
    name: "Probabilité de victoire",
    summary: "Tes chances de gagner, mesurées sur les parties collectées.",
    source: "Grille observée par NEX (backend) + écart d'or estimé de la partie en cours",
    frequency: "Grille chargée une fois par partie ; case relue à chaque instantané",
    transform:
      "Ce n'est pas un modèle : NEX compte, sur les parties qu'il a collectées, la part des situations suivies d'une victoire, par tranche de 5 minutes et par millier d'or d'écart. La case affichée est celle de ta tranche et de ton écart d'or estimé.",
    missing:
      "Aucun chiffre si la case compte moins de 60 situations observées, ni avant 2:30 ou après 37:30. Aucun repli sur une case voisine. Deux réserves : l'écart d'or est estimé (cf. Or des équipes), et les parties collectées sont des classées Master et au-dessus.",
  },
  counters: {
    name: "Counters",
    summary: "Les meilleurs choix contre ton adversaire de voie.",
    source: "Sélection des champions du client local + tier list et matchups des parties collectées",
    frequency: "Lu une fois par adversaire de voie identifié",
    transform:
      "Réutilise la méthode déjà employée par l'assistant de draft : force au poste (taux ajusté − 50 %) plus l'avantage de ligne, atténué par l'effectif (n / (n + 10)). Si l'adversaire perd X points contre un champion, ce champion gagne X points.",
    missing:
      "Rien tant que l'adversaire de voie n'est pas choisi, ou si l'échantillon est trop mince. Un écart de taux n'est pas un taux de victoire : les deux sont affichés séparément.",
  },
  runes: {
    name: "Runes et build",
    summary: "La page la plus jouée sur ton champion, pendant la sélection.",
    source: "Sélection des champions du client local + builds des parties collectées",
    frequency: "Chargé une fois par champion et par poste",
    transform: "Page de runes, sorts d'invocateur, objets de départ, build principal et ordre des compétences les plus observés à ce poste.",
    missing:
      "Rien tant que ton champion n'est pas choisi, ou si le champion n'a pas assez de parties collectées à ce poste. L'overlay n'importe rien dans le client : l'import reste dans la page Builds, déclenché par toi.",
  },
  inhibs: {
    name: "Timers d'inhibiteurs",
    summary: "Quand les inhibiteurs détruits réapparaissent.",
    source: "Live Client Data (événements InhibKilled et InhibRespawned, annoncés à tous)",
    frequency: "Recalculé à chaque instantané",
    transform:
      "Réapparition cinq minutes après la destruction. Une annonce de réapparition par le jeu efface le minuteur : l'annonce prime sur le calcul.",
    missing:
      "Rien tant qu'aucun inhibiteur n'est tombé, et hors Faille. Si l'identifiant publié n'est pas reconnu, il est affiché tel quel plutôt que rattaché à une voie incertaine.",
  },
  clock: {
    name: "Chronomètre et stats",
    summary: "Ton CS et ton KDA sans ouvrir le tableau des scores.",
    source: "Live Client Data (gameTime, scores du joueur)",
    frequency: "Instantané toutes les 2 s, chronomètre interpolé à la seconde",
    transform: "CS/min = CS / minutes de jeu ; KDA = (É + A) / max(1, M)",
    missing: "« En attente de partie » ; aucune valeur inventée",
  },
  objectives: {
    name: "Timers d'objectifs",
    summary: "Dragon et baron : ne sois plus pris de court.",
    source: "Live Client Data (événements DragonKill, BaronKill annoncés à tous)",
    frequency: "Recalculé à chaque instantané",
    transform: "Premier dragon 5:00 ; réapparitions : dragon +5:00, Ancien +6:00, baron +6:00 après l'événement",
    missing: "Aucun minuteur affiché sans événement vérifiable",
  },
  build: {
    name: "Ordre d'achat",
    summary: "Quoi acheter, et la suite du build principal.",
    source: "Build observé NEX (backend) pour ton champion + inventaire visible",
    frequency: "Build chargé une fois par partie ; inventaire toutes les 2 s",
    transform: "Premier objet du build principal pas encore possédé, puis la suite dans l'ordre observé. Les objets déjà achetés sont marqués.",
    missing: "Masqué si le champion n'a pas assez de parties collectées",
  },
  skills: {
    name: "Rappel de compétence",
    summary: "Ne laisse jamais un point de compétence dormir.",
    source: "Live Client Data (niveau, rangs des compétences) + priorité observée + fiche du champion (Data Dragon) pour l'icône",
    frequency: "Toutes les 2 s",
    transform: "Points libres = niveau − somme des rangs ; R proposé aux niveaux 6/11/16",
    missing: "Masqué quand aucun point n'est à placer",
  },
  trinket: {
    name: "Rappel de trinket",
    summary: "Pense à passer à la lentille au niveau 9.",
    source: "Live Client Data (objet en emplacement 7, niveau)",
    frequency: "Toutes les 2 s",
    transform: "Rappel au niveau 9+ si le totem invisible est encore équipé",
    missing: "Masqué sinon (désactivé par défaut)",
  },
};
