//**
 * fetch-results.js
 * Source : lesbonsnumeros.com — HTML statique, zéro JS requis.
 * Zéro dépendance externe — Node 24 natif uniquement.
 */

import fs   from 'fs';
import path from 'path';

const BASE      = 'https://www.lesbonsnumeros.com';
const LIST_URL  = `${BASE}/euromillions/resultats/`;
const DATA_FILE = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

const MOIS = {
  'janvier':1,'février':2,'mars':3,'avril':4,'mai':5,'juin':6,
  'juillet':7,'août':8,'septembre':9,'octobre':10,'novembre':11,'décembre':12
};

/* ── CSV ──────────────────────────────────────────────── */

function readExistingDates(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  return new Set(
    fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1).map(l => l.split(',')[0])
  );
}

function appendRow(filePath, row) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, CSV_HEADER + '\n');
  fs.appendFileSync(filePath, row + '\n');
}

/* ── Parse ────────────────────────────────────────────── */

/**
 * Extrait le premier bloc "Derniers tirages" de la page de liste.
 * Structure HTML :
 *   <h2><a>Euromillions Vendredi 10 Avril</a></h2>
 *   <ul><li>10</li><li>13</li>...<li>6</li><li>9</li></ul>
 *
 * On cherche l'URL du dernier tirage pour en extraire la date.
 * Pattern URL : rapports-tirage-{id}-{jour}-{DD}-{mois}-{YYYY}.htm
 */
function parseListPage(html) {
  // Trouver la première URL de tirage
  const urlRe = /rapports-tirage-\d+-\w+-(\d+)-(\w+)-(\d{4})\.htm/;
  const urlMatch = html.match(urlRe);
  if (!urlMatch) return null;

  const day   = urlMatch[1].padStart(2, '0');
  const month = String(MOIS[urlMatch[2].toLowerCase()] ?? 0).padStart(2, '0');
  const year  = urlMatch[3];
  if (month === '00') return null;
  const date = `${year}-${month}-${day}`;

  // Extraire les 7 numéros du premier bloc de résultat
  // Les <li> contenant uniquement un nombre (1 ou 2 chiffres)
  const sectionStart = html.indexOf(urlMatch[0]);
  const section = html.slice(sectionStart, sectionStart + 1500);

  const numRe = /<li>(\d{1,2})<\/li>/g;
  const found = [];
  let m;
  while ((m = numRe.exec(section)) !== null && found.length < 7) {
    found.push(parseInt(m[1], 10));
  }

  if (found.length < 7) return null;

  const nums  = found.slice(0, 5).sort((a, b) => a - b);
  const stars = found.slice(5, 7).sort((a, b) => a - b);

  return { date, nums, stars };
}

/* ── Fetch ────────────────────────────────────────────── */

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (err) {
      console.warn(`Tentative ${attempt}/${retries} : ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
      else throw err;
    }
  }
}

/* ── Main ─────────────────────────────────────────────── */

async function main() {
  const filePath      = path.resolve(DATA_FILE);
  const existingDates = readExistingDates(filePath);

  console.log(`Fichier cible     : ${filePath}`);
  console.log(`Tirages existants : ${existingDates.size}`);
  console.log(`Source            : ${LIST_URL}`);

  const html = await fetchPage(LIST_URL);
  const draw = parseListPage(html);

  if (!draw) {
    const snippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600);
    console.error('Impossible de parser le dernier tirage.');
    console.error('Extrait :', snippet);
    process.exit(1);
  }

  console.log(`Tirage trouvé     : ${draw.date} — ${draw.nums.join(',')} | ★${draw.stars.join(',')}`);

  if (existingDates.has(draw.date)) {
    console.log('Tirage déjà présent — rien à faire.');
    process.exit(0);
  }

  const row = [draw.date, ...draw.nums, ...draw.stars].join(',');
  appendRow(filePath, row);
  console.log(`Nouveau tirage ajouté : ${row}`);
}

main().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});