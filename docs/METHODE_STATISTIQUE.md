# Méthode statistique NEX

Tout calcul vit dans `src/domain/` et est couvert par `src/domain/*.test.ts`.

## Règles générales

1. **Parties comptabilisées** : les remakes et les parties de moins de 300 s ou de durée invalide sont exclus de toutes les moyennes.
2. **Ratios de sommes** : KDA, participation, CS/min, dégâts/min et part des dégâts sont calculés comme Σnumérateur / Σdénominateur sur la période, jamais comme une moyenne de ratios par partie.
3. **Valeurs absentes** : une métrique sans donnée vaut `null` et s'affiche « — », jamais 0. L'écart d'or @15 et les solo kills nécessitent la timeline : la moyenne porte sur les seules parties qui l'ont, et l'effectif est affiché au clic sur la carte.
4. **0 mort** : le KDA divise par 1 (convention usuelle). L'historique affiche « Sans mort ».
5. **Période affichée** : chaque bloc indique la file, le nombre de parties et la période de comparaison.

## Sources réelles (étape 2)

- **Équipe** : la participation et la part des dégâts utilisent les totaux de l'équipe du joueur dans le match (somme des participants de même `teamId`).
- **Écart d'or @15** : or total (`totalGold`) du joueur moins celui de l'adversaire direct (même `teamPosition` dans l'équipe adverse). On prend la frame de timeline la plus proche de 15:00, à 30 s près. La valeur est absente si la partie dure moins de 15 minutes, si la timeline n'est pas chargée ou s'il n'y a pas d'adversaire de même poste. Le backend charge les timelines des 10 parties les plus récentes pour le dashboard et des 5 premières pour l'historique.
- **Solo kills** : `challenges.soloKills` fourni par Riot dans match-v5. Absent → « — ».
- **Modes retenus** : Classée Solo/Duo, Flex, Normales et ARAM. Arena, URF et les autres modes restent visibles dans l'historique mais sont exclus des moyennes, car leurs règles faussent KP, CS et part des dégâts.
- **Échantillon** : les statistiques de profil portent sur les parties chargées, avec la période affichée. Ce ne sont pas des statistiques de saison complète.
- **LP** : la variation par partie n'est pas affichée en mode réel. Riot ne la fournit pas, et l'estimer serait trompeur.

## Variation (flèches du dashboard)

Pour une fenêtre de N parties (N = moitié de la période choisie, au moins 3), la variation compare les N parties les plus récentes ayant une valeur aux N précédentes, avec la même métrique, la même file et la même définition. Elle n'est pas calculée si l'un des deux blocs compte moins de 3 parties. Les pourcentages varient en **points** (« pts »), les autres métriques en valeur absolue.

## Score NEX (v0.1-provisoire)

Note de 0 à 100 d'une partie, explicable composante par composante.

```
composante_i = clamp((valeur_i − repère_i(rôle)) / échelle_i, −1, 1)
score = 50 + 50 × Σ (poids_i / Σ poids disponibles) × composante_i
```

| Composante | Poids | Échelle |
| --- | --- | --- |
| KDA | 30 % | repère KDA du rôle |
| Participation aux éliminations | 20 % | 25 points |
| CS/min | 20 % | max(1, 35 % du repère) |
| Part des dégâts | 20 % | 60 % du repère |
| Vision/min | 10 % | 80 % du repère |

- 50 = exactement au repère du rôle sur toutes les composantes ; 0 et 100 sont les bornes.
- Une composante indisponible est retirée et les poids sont renormalisés.
- **Limite** : les repères actuels (`BASELINES` dans `src/domain/nexScore.ts`) sont des valeurs indicatives fixées à la main. Ils seront remplacés par des médianes par rôle, rang et patch calculées par le backend NEX. La version du score est affichée avec les données.
- Le score décrit la performance relative à des repères. Ce n'est ni une prédiction de victoire, ni un MMR.

## NEX Insight (analyse après partie)

Sur la période filtrée, NEX fait la moyenne de la contribution de chaque composante du score. La composante la plus négative est présentée comme « axe de progression », avec la valeur du joueur et le repère. Les deux viennent des parties affichées.

## Statistiques agrégées (étape 3)

**Source.** Le collecteur du backend récupère les parties Solo/Duo des 14 derniers jours des joueurs Challenger, Grand Maître et Maître des plateformes configurées (EUW par défaut), avec leur timeline. Chaque partie est ingérée une seule fois. Les remakes, les parties de moins de 5 minutes et celles dont un poste est inconnu sont exclus.

**Périmètre.** Patch (deux premiers nombres de la version du jeu), file, région et rang. Le rang est celui du joueur dont la partie a été collectée, pas la moyenne des 10 participants. Chaque écran affiche son périmètre et le nombre de parties collectées.

**Tier list.**
- Taux ajusté = (victoires + 20) / (parties + 40), soit un retrait bayésien vers 50 %.
- Tiers : S+ ≥ 53,5 %, S ≥ 52 %, A ≥ 50,5 %, B ≥ 49 %, C ≥ 47,5 %, D en dessous.
- « ? » sous 20 parties (`MIN_GAMES`).
- Pick rate : parties du champion à ce poste / parties du périmètre.
- Ban rate : parties où il est banni / parties du périmètre.

**Builds** (timeline requise pour les achats et les compétences).
- Départ : objets achetés avant 1:30, annulations retirées.
- Build principal : 3 premiers objets terminés dans l'ordre d'achat (≥ 2 200 PO, sans amélioration, Faille uniquement).
- Bottes : premières bottes de rang 2 ou plus.
- Situationnels : objets terminés achetés en 4e à 6e position.
- Priorité de compétences : ordre dans lequel A, Z et E atteignent le rang 5.
- Ce sont des fréquences observées. Elles ne prouvent pas qu'un objet fait gagner.

**Matchups.**
- Adversaire direct : même poste dans l'équipe adverse.
- Écart = taux de victoire du champion contre cet adversaire − taux moyen du champion au même poste sur le même périmètre, en **points de pourcentage**. La variation relative (écart / moyenne) est indiquée au survol.
- Favorable ≥ +2 pts, difficile ≤ −2 pts, équilibré entre les deux.
- Le graphique n'affiche que les adversaires dont l'effectif atteint le minimum choisi (5 par défaut).
- L'empilement vertical sert seulement à éviter les chevauchements.

**Assistant de sélection.**
- Score = (taux ajusté − 50 %) + avantage de ligne × n / (n + 10). L'avantage de ligne est l'écart de l'adversaire de ligne contre le candidat, inversé, et n'est retenu qu'à partir de 3 parties.
- Profil de composition : notes Data Dragon physique/magique et classes. C'est indicatif.
- **Aucune probabilité de victoire n'est affichée** : NEX n'a pas de modèle prédictif évalué et calibré.

**Taille d'échantillon.** Avec une clé de développement Riot, le collecteur ajoute environ 300 à 500 parties par heure. En dessous de 20 parties, les valeurs sont marquées « échantillon faible ». Elles restent visibles comme tendances, jamais présentées comme des certitudes.

## Ce que NEX ne calcule pas

- Pas de probabilité de victoire sans modèle évalué, calibré et documenté.
- Pas de MMR caché, pas de désanonymisation.
- Pas d'avantage d'or exact déduit de la valeur des objets.
