/**
 * fetch-results.js
 * Récupère le dernier tirage EuroMillions depuis fdj.fr
 * et l'ajoute à draws.csv si absent.
 *
 * Source : fdj.fr/jeux-de-tirage/euromillions-my-million/resultats
 * Zéro dépendance externe — Node 24 natif uniquement.
 */

import fs   from 'fs';
import path from 'path';

const FDJ_RESULTS = 'https://www.fdj.fr/jeux-de-tirage/euromillions-my-million/resultats';
const DATA_FILE   = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER  = 'date,n1,n2,n3,n4,n5,s1,s2';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Cache-Control': 'no-cache',
};

/* ── CSV ─────────────────────────────────────────────── */

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

/* ── Parse FDJ ───────────────────────────────────────── */

const MOIS = {
  'janvier':1,'février':2,'mars':3,'avril':4,'mai':5,'juin':6,
  'juillet':7,'août':8,'septembre':9,'octobre':10,'novembre':11,'décembre':12
};

function parseFrenchDate(str) {
  const m = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const day   = m[1].padStart(2, '0');
  const month = String(MOIS[m[2].toLowerCase()] ?? 0).padStart(2, '0');
  const year  = m[3];
  if (month === '00') return null;
  return `${year}-${month}-${day}`;
}

function parseLatestDraw(html) {
  const comboRe = /(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})\s+et les deux étoiles[^,]*,\s+le\s+(\d{1,2})\s+et\s+le\s+(\d{1,2})/;
  const comboMatch = html.match(comboRe);

  const dateRe = /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}\s+\w+\s+\d{4}/gi;
  const dateMatches = [...html.matchAll(dateRe)];

  if (!comboMatch || dateMatches.length === 0) return null;

  const date  = parseFrenchDate(dateMatches[0][0]);
  if (!date) return null;

  const nums  = [1,2,3,4,5].map(i => parseInt(comboMatch[i], 10)).sort((a,b)=>a-b);
  const stars = [6,7].map(i => parseInt(comboMatch[i], 10)).sort((a,b)=>a-b);

  return { date, nums, stars };
}

/* ── Fetch avec retry ────────────────────────────────── */

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

/* ── Main ────────────────────────────────────────────── */

async function main() {
  const filePath      = path.resolve(DATA_FILE);
  const existingDates = readExistingDates(filePath);

  console.log(`Fichier cible     : ${filePath}`);
  console.log(`Tirages existants : ${existingDates.size}`);
  console.log(`Source            : ${FDJ_RESULTS}`);

  const html = await fetchPage(FDJ_RESULTS);
  const draw = parseLatestDraw(html);

  if (!draw) {
    const snippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500);
    console.error('Impossible de parser le dernier tirage.');
    console.error('Extrait HTML brut :', snippet);
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