# Prompt — refaire la page Overlays en grille de cartes

## Ce qu'on veut obtenir

La page de réglages des overlays doit ressembler à la référence : **une grille de cartes,
une carte par overlay**. Chaque carte montre à quoi ressemble le widget, le nomme en une
ligne, et porte un interrupteur. Les réglages fins ne sont plus à l'écran en permanence :
ils s'ouvrent depuis une roue dentée sur la carte.

Sur la référence, une carte contient quatre choses et rien d'autre :

1. **Un aperçu** du widget, qui occupe presque toute la carte.
2. **Un titre** court, en bas à gauche.
3. **Une phrase** sous le titre, qui dit à quoi ça sert — pas comment c'est calculé.
4. **Un interrupteur** en bas à droite, et **une roue dentée** en haut à droite.

Les cartes ne sont pas toutes de la même taille : une carte vedette occupe deux rangées,
les autres une seule. Les overlays sont regroupés en sections (« En jeu », « Rappels »).

## Ce que NEX a aujourd'hui, et pourquoi ça ne va pas

`src/features/overlays/OverlaysPage.tsx` affiche une liste de lignes. Chaque ligne entasse
sur un seul rang : une case « visible », une case « verrouillé », deux curseurs (échelle,
opacité), un menu « affichage », puis quatre paragraphes de documentation (source,
fréquence, calcul, si absent).

Trois défauts :

- **On ne voit pas ce qu'on règle.** Rien ne montre le widget. Il faut ouvrir le jeu pour
  savoir de quoi on parle.
- **Tout est au même niveau.** L'interrupteur, qu'on touche souvent, a la même importance
  visuelle que le curseur d'opacité, qu'on règle une fois.
- **La documentation écrase l'interface.** Les quatre paragraphes par widget sont précieux,
  mais ils transforment une page de réglages en notice.

## Ce qu'il faut construire

### La grille

Remplacer `.widget-list` par une grille de cartes. Une carte par entrée de `layout`
(sept aujourd'hui : `gold`, `winprob`, `clock`, `objectives`, `build`, `skills`,
`trinket`). Deux sections :

- **En jeu** : `gold`, `winprob`, `clock`, `objectives`
- **Rappels** : `build`, `skills`, `trinket`

Une carte vedette sur deux rangées pour `winprob` (c'est la plus parlante), les autres sur
une rangée.

### L'aperçu

C'est le point qui demande le plus de soin, et celui qui ne doit pas déraper.

**Réutiliser les vrais composants de `src/overlay/OverlayApp.tsx`**, pas des images. Il faut
donc les extraire dans un module partagé (`src/overlay/widgets/`) pour que la page de
réglages et la fenêtre d'overlay rendent exactement le même code. Sans cette extraction,
l'aperçu mentirait dès la première divergence.

Deux cas :

- **En partie** : rendre le widget avec l'instantané réel. L'aperçu est alors la vérité.
- **Hors partie** : rendre le widget avec un jeu de valeurs d'exemple, et **marquer la carte
  « exemple »** de façon visible, comme l'aperçu des badges Mayhem est marqué « DÉMO ».
  Les valeurs d'exemple vivent dans un seul module, à côté de `demoSnapshot()` de
  `src/platform/web.ts`, et ne doivent jamais pouvoir atteindre la fenêtre d'overlay.

L'aperçu est inerte : pas de clic, pas de glisser. L'aperçu est mis à l'échelle pour tenir
dans la carte (`transform: scale`), sans changer les réglages du widget.

### L'interrupteur

Il pilote `w.visible`, par `platform.overlayLayoutSet`. C'est le seul réglage directement
sur la carte. Un vrai interrupteur, pas une case à cocher : c'est ce qu'on vient faire ici.

Quand un widget est éteint, la carte reste lisible mais s'efface (aperçu désaturé).

### La roue dentée

Elle ouvre un panneau — tiroir latéral ou boîte modale — qui contient tout le reste :

- Échelle, opacité (les deux curseurs actuels)
- Affichage : « Toujours » / « Sur une touche », avec le rappel de `Ctrl+Alt+E`
- Verrouillé
- Les quatre champs de `WIDGET_INFO` : source, fréquence, calcul, si absent

**Ces quatre champs ne sont pas négociables.** C'est ce qui distingue NEX d'un outil qui
affiche des chiffres sans dire d'où ils viennent. Ils sortent de la page principale, ils ne
disparaissent pas. En particulier, les deux réserves portées par `gold` et `winprob` (or
estimé, population Master et au-dessus) doivent rester lisibles.

### La description d'une ligne

`WIDGET_INFO` n'a pas ce champ aujourd'hui. Il faut l'ajouter : un `summary` court, orienté
usage, distinct de `transform` qui explique le calcul.

Exemples de ton, à partir de la référence :

| Widget | `summary` |
| --- | --- |
| `gold` | Qui est le plus riche, d'un coup d'œil. |
| `winprob` | Tes chances de gagner, mesurées sur les parties collectées. |
| `clock` | Ton CS et ton KDA sans ouvrir le tableau des scores. |
| `objectives` | Dragon et baron : ne sois plus pris de court. |
| `build` | Le prochain objet à acheter, d'après les parties observées. |
| `skills` | Ne laisse jamais un point de compétence dormir. |
| `trinket` | Pense à passer à la lentille au niveau 9. |

### Ce qui ne bouge pas

Le reste de la page garde sa place, au-dessus ou au-dessous de la grille :

- Le rappel du **mode fenêtré sans bordure** et des raccourcis globaux. C'est ce qui explique
  pourquoi un overlay peut sembler cassé ; il doit rester en évidence.
- L'avertissement sur un **raccourci déjà pris** par une autre application (`failedShortcuts`).
- L'éditeur de disposition (`LayoutEditor`), les boutons d'ouverture/fermeture, et la section
  **Badges ARAM Mayhem**.
- Le paragraphe **Règles**.

## Les pièges à éviter

- **Ne pas dessiner de faux aperçus.** Une image figée qui ne correspond plus au widget est
  pire que pas d'aperçu du tout. D'où l'extraction des composants.
- **Ne pas laisser un exemple passer pour du réel.** Toute carte rendue hors partie porte sa
  marque « exemple ».
- **Ne pas perdre la documentation** en la déplaçant dans le panneau : vérifier que les quatre
  champs de chaque widget restent atteignables en deux clics.
- **Ne pas casser `width: max-content`** sur `.ov-widget` : c'est ce qui empêche les widgets
  larges d'être coupés. L'aperçu met à l'échelle, il ne contraint pas la largeur.
- **Vérifier les sept cartes**, y compris celles dont le widget ne rend rien dans certains cas
  (`build` sans build observé, `skills` sans point à placer, `winprob` sur une situation trop
  peu observée). Une carte ne doit jamais être vide : elle montre l'état « rien à afficher »
  tel que le widget le montrerait.

## Vérification attendue

- `npm run check` (tsc, vitest, cargo test) au vert.
- La page ouverte dans le navigateur (`npm run dev`), les sept cartes rendues, chaque
  interrupteur basculé et l'effet constaté sur `overlayLayoutGet`.
- Chaque panneau de roue dentée ouvert, les quatre champs présents.
- Une capture de la grille.
