# Publier NEX sur GitHub

Préparé le 13 novembre 2026. Ce dépôt servira d'URL publique pour la demande de clé Riot
(voir [DEMANDE-CLE-RIOT.md](DEMANDE-CLE-RIOT.md)).

## Ce qui est déjà prêt

- **`README.md`** réécrit en page produit : ce que fait NEX, ce qu'il ne fait pas, comment il
  utilise l'API Riot, la mention légale. C'est ce qu'un évaluateur Riot lira.
- **Trois captures** dans `docs/captures/` (dashboard, profil, Data Studio), affichées dans le
  README.
- **`.gitignore` durci.** Il exclut `backend/.env` et toute variante (`.env`, `.env.*`, `*.env`),
  les clés et certificats, les sauvegardes `*.bak`, les bases SQLite, `target/`,
  `node_modules/`, `src-tauri/gen/` et `.claude/settings.local.json`.

## Ce qui bloque

**`git` n'est pas installé sur cette machine**, et `gh` (GitHub CLI) non plus. Je ne peux donc
ni créer le dépôt ni publier quoi que ce soit. Installe-les d'abord :

```bash
winget install --id Git.Git -e
```

```bash
winget install --id GitHub.cli -e
```

Ferme puis rouvre le terminal après l'installation, pour que le `PATH` soit à jour.

## Une décision avant de publier

**Dépôt public ou privé ?** Riot a besoin d'une URL qui s'ouvre **sans compte**. Un dépôt
privé ne convient pas pour la demande de clé.

> **Captures anonymisées.** Les trois images de `docs/captures/` ont été reprises avec le
> pseudo remplacé par « Invocateur » : ton Riot ID n'y figure plus. Restent visibles le niveau
> du compte, le rang et le bilan victoires/défaites, qui ne désignent personne à eux seuls.
> Les noms des autres joueurs n'apparaissent sur aucune des trois.

## Les commandes, une fois git installé

À lancer dans `C:\Users\Farouk\Documents\mon-app`.

Vérifie d'abord ton identité git :

```bash
git config --global user.name "Farouk"
```

```bash
git config --global user.email "ton.email@exemple.com"
```

Puis initialise le dépôt :

```bash
git init -b main
```

**Avant le premier commit, vérifie qu'aucun secret n'est suivi.** Cette commande doit afficher
`backend/.env` comme ignoré ; si elle n'affiche rien, arrête-toi et préviens-moi :

```bash
git check-ignore -v backend/.env
```

Contrôle aussi la liste de ce qui partira — elle ne doit contenir ni `.env`, ni `.sqlite3`, ni
`target/`, ni `node_modules/` :

```bash
git add -A && git status --short
```

Si la liste est saine, fais le commit :

```bash
git commit -m "NEX : application compagnon League of Legends"
```

Crée le dépôt public et pousse, en une commande :

```bash
gh auth login
```

```bash
gh repo create nex --public --source=. --remote=origin --push
```

L'URL à donner à Riot sera affichée à la fin, de la forme `https://github.com/<ton-compte>/nex`.

## Si tu préfères passer par le site

Crée le dépôt vide sur github.com (public, sans README ni .gitignore, pour éviter un conflit),
puis :

```bash
git remote add origin https://github.com/<ton-compte>/nex.git
```

```bash
git push -u origin main
```

## Après publication

Ouvre l'URL dans une fenêtre de navigation privée pour confirmer qu'elle s'affiche sans compte,
puis reporte-la dans le champ **Product URL** du formulaire Riot.

## En cas de secret poussé par erreur

Si un jour un secret part dans un commit : considère-le comme compromis. Révoque-le d'abord
(nouvelle clé sur le portail Riot, nouveau mot de passe Leaguepedia), **puis** nettoie
l'historique. Retirer le fichier dans un commit suivant ne suffit pas, il reste lisible dans
l'historique.
