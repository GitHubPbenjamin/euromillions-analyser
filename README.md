# EuroMillions Analyser

Collecte automatique des résultats EuroMillions via GitHub Actions + CSV versionné.

## Structure

```
.
├── .github/
│   └── workflows/
│       ├── fetch-results.yml   # Collecte auto mardi + vendredi soir
│       ├── backfill.yml        # Remplissage historique à la demande
│       └── validate.yml        # Validation du CSV à chaque push/PR
├── data/
│   └── draws.csv               # Source de vérité — jamais modifier à la main
├── scripts/
│   ├── package.json
│   ├── fetch-results.js        # Récupère le dernier tirage
│   ├── backfill.js             # Télécharge un intervalle de dates
│   └── validate.js             # Vérifie l'intégrité du CSV
└── src/                        # Application web (voir section ci-dessous)
```

## Format de draws.csv

```
date,n1,n2,n3,n4,n5,s1,s2
2024-11-22,3,12,27,34,48,2,9
2024-11-26,7,19,23,41,50,4,11
```

- `date` : ISO 8601 (YYYY-MM-DD)
- `n1`–`n5` : 5 numéros principaux triés (1–50)
- `s1`–`s2` : 2 étoiles triées (1–12)

## Démarrage rapide

### 1. Initialiser l'historique (backfill)

Depuis GitHub → **Actions** → **Backfill historique EuroMillions** → **Run workflow**

Paramètres disponibles :
- `from_date` : date de début (défaut : `2021-01-01`)
- `to_date`   : date de fin (défaut : aujourd'hui)
- `full_history` : cocher pour tout récupérer depuis 2004

### 2. Collecte automatique

Le workflow `fetch-results.yml` se déclenche automatiquement :
- **Mardi à 21h30 UTC** (23h30 heure France)
- **Vendredi à 21h30 UTC**

Il peut aussi être lancé manuellement depuis l'onglet Actions.

### 3. Lancer les scripts localement

```bash
cd scripts
npm install

# Récupérer le dernier tirage
node fetch-results.js

# Backfill d'une période
node backfill.js --from 2023-01-01 --to 2023-12-31

# Valider le CSV
node validate.js ../data/draws.csv
```

## Source des données

API communautaire gratuite : **https://euromillions.api.pedromealha.dev**

> Les données sont issues du site euro-millions.com et fournies à titre informatif.
> Ce projet n'est pas affilié à l'organisation EuroMillions.

## Permissions GitHub Actions

Le workflow a besoin d'écrire dans le repository pour committer le CSV.

Dans **Settings → Actions → General → Workflow permissions** :
cocher **Read and write permissions**.

## Intégration dans l'application web

```js
// Charger les données depuis le CSV versionné (via CDN jsDelivr)
const CSV_URL =
  'https://cdn.jsdelivr.net/gh/VOTRE_USER/euromillions-analyser@main/data/draws.csv';

const res  = await fetch(CSV_URL);
const text = await res.text();
const rows = text.trim().split('\n').slice(1).map(line => {
  const [date, n1, n2, n3, n4, n5, s1, s2] = line.split(',');
  return {
    date,
    nums:  [n1, n2, n3, n4, n5].map(Number),
    stars: [s1, s2].map(Number),
  };
});
```

Le CSV est mis en cache par jsDelivr — les nouvelles données sont disponibles
quelques minutes après le commit du workflow.
