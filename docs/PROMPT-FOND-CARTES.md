# Prompt — mettre une illustration en fond des cartes d'overlay

> **Construit le 13/11/2026.** Contrastes mesurés en composant les couches (illustration,
> voile, dégradé du pied) sur les 5 % de pixels les plus clairs de la ligne du texte :
> titre 11,9 à 16,5 · ligne de description 6,0 · étiquette « exemple » 5,2 à 6,0.
> La roue dentée tombait à **2,4**, sous le seuil de 3 d'un élément non textuel : son fond
> est passé de 0,7 à 0,88 et sa couleur de `--dim` à `--muted`, ce qui la remonte à 5,6.
>
> **Écart au prompt, demandé après coup :** un champion *différent* par carte, pris dans la
> composition de la partie (ou de l'exemple), au lieu d'un seul champion partout. On perd
> l'image unique en cache, on gagne en vie. Contrôle refait sur les sept illustrations
> réelles : pire titre 13,4 · pire ligne 6,1 · pire étiquette 5,2 · pire roue 5,6.

## Le problème

Les cartes de la page Overlays (`.ov-card`, `src/styles/overlay.css`) ont pour fond un
dégradé sombre uni. L'aperçu du widget flotte dans le vide. Sur la référence, chaque carte
porte une illustration derrière le widget : c'est ce qui donne l'impression de voir le
widget *en jeu* plutôt que posé sur une case grise.

## D'où viennent les images

**Rien de nouveau à aller chercher.** L'app utilise déjà les illustrations Data Dragon de
Riot, et le même motif existe sur le Dashboard :

- `championSplash(key, skin)` — horizontal, ~1215×717. Pour les grandes surfaces.
- `championLoading(key, skin)` — vertical, ~308×560, bien plus léger. Pour les cartes.
- Les deux valident la clé de champion par expression régulière avant de la mettre dans
  une URL (`src/data/assets.ts`).
- `RemoteImg` (`src/ui/primitives.tsx`) gère le chargement et l'échec.
- Le CSS de référence est `.full-card img.bg` (`src/styles/dashboard.css`) :
  `position: absolute; inset: 0; object-fit: cover; object-position: 50% 15%`.

**Ne pas** embarquer de captures du jeu dans le dépôt, ni aller chercher des illustrations
ailleurs que Data Dragon : c'est la seule source dont l'usage est déjà établi ici.

## Quelle image sur quelle carte

C'est la vraie décision. La règle proposée, qui suit la logique déjà retenue pour les
aperçus (le réel quand il existe, l'exemple sinon) :

1. **En partie** : le champion que tu joues. La carte montre alors ton widget, avec tes
   données, sur ton champion — tout est cohérent.
2. **Hors partie** : le champion de l'instantané d'exemple (`EXAMPLE_SNAPSHOT`, soit Ahri).
   La carte porte déjà la mention « exemple », l'illustration ne ment pas davantage.

Raffinement possible dans un second temps : hors partie, prendre le champion le plus joué
du profil, et le skin possédé s'il y en a un (`skinInventory`). À ne faire qu'après que le
premier jet fonctionne — ça ajoute un appel et un cas d'erreur.

**À éviter** : une illustration différente et arbitraire par widget (« Zed pour les
timers »). Ça n'aurait aucun sens et il faudrait la maintenir.

## Les contraintes à tenir

### 1. La lisibilité passe avant l'image

C'est une page de réglages, pas une galerie. Le widget en aperçu, l'intitulé, la ligne de
description et l'interrupteur doivent rester aussi lisibles qu'aujourd'hui.

Il faut donc un voile entre l'image et le contenu : un calque sombre au-dessus de
l'illustration, plus opaque en bas (derrière le texte) qu'en haut. Le pied de carte a déjà
son propre dégradé (`.ov-card-foot`), il faut vérifier que les deux se cumulent bien au
lieu de se battre.

**Vérification attendue, pas à l'œil** : mesurer le contraste du texte du pied et de
l'intitulé du widget sur plusieurs illustrations claires (Lux, Soraka) et sombres
(Nocturne). Si une illustration claire fait tomber la lisibilité, c'est le voile qu'il faut
renforcer, pas l'illustration qu'il faut choisir.

### 2. `RemoteImg` affiche des initiales quand l'image échoue

C'est son comportement normal et utile ailleurs — mais en fond de carte, un échec afficherait
**« AH » en gros au milieu de la carte**. Il faut traiter ce cas : en cas d'échec, la carte
doit simplement retrouver son dégradé actuel, sans rien d'autre.

Le dégradé sombre reste donc la couche de base, l'image se pose par-dessus. Rien ne doit
clignoter au premier rendu ni hors connexion.

### 3. Sept images d'un coup

La page affiche sept cartes. Utiliser `championLoading` (308×560) et non `championSplash`
pour les cartes normales ; le splash uniquement pour la carte vedette, qui est la seule assez
grande pour en profiter. Ajouter `loading="lazy"` et `decoding="async"`.

Si toutes les cartes montrent le même champion, le navigateur ne télécharge l'image qu'une
fois — c'est un argument de plus pour la règle « un seul champion » ci-dessus.

### 4. L'état éteint

`.ov-card.off` grise déjà l'aperçu (`filter: grayscale(1)`). L'illustration doit suivre le
même sort, sinon une carte éteinte restera la plus voyante de la page.

### 5. Ce qui est déjà par-dessus

L'étiquette « exemple » et la roue dentée ont leur propre fond sombre. Vérifier quand même
qu'ils tiennent sur une illustration claire.

## Vérification attendue

- `npm run check` au vert.
- La page ouverte (`npm run dev`, puis `?desktop`), les sept cartes avec leur illustration.
- Une carte dont l'image échoue (couper le réseau, ou forcer une clé invalide) : la carte
  doit retrouver son dégradé, **sans initiales**.
- Une carte éteinte : illustration grisée comme l'aperçu.
- Mesure du contraste du texte sur une illustration claire.
- Une capture avant / après.
