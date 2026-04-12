/**
 * fetch-results.js
 * Récupère le dernier tirage EuroMillions depuis euro-millions.com
 * et l'ajoute à draws.csv si absent.
 *
 * Zéro dépendance externe — Node 24 natif uniquement.
 */

import fs   from 'fs';
import path from 'path';

const BASE_URL   = 'https://www.euro-millions.com';
const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; euromillions-analyser/1.0)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

/* ── Helpers CSV ─────────────────────────────────────── */

function readExistingDates(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  return new Set(lines.slice(1).map(l => l.split(',')[0]));
}

function appendRow(filePath, row) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, CSV_HEADER + '\n');
  fs.appendFileSync(filePath, row + '\n');
}

/* ── Parsing HTML ────────────────────────────────────── */

function parseResultsPage(html) {
  const draws = [];
  const blocks = html.split(/data-draw-date=/);

  for (const block of blocks.slice(1)) {
    const dateMatch = block.match(/^"(\d{4}-\d{2}-\d{2})"/);
    if (!dateMatch) continue;
    const date = dateMatch[1];

    const nums  = [];
    const stars = [];

    const numRe  = /class="[^"]*ball-number[^"]*"[^>]*>(\d+)<\/li>/g;
    const starRe = /class="[^"]*ball-star[^"]*"[^>]*>(\d+)<\/li>/g;
    let m;

    while ((m = numRe.exec(block))  !== null && nums.length  < 5) nums.push(parseInt(m[1], 10));
    while ((m = starRe.exec(block)) !== null && stars.length < 2) stars.push(parseInt(m[1], 10));

    if (nums.length === 5 && stars.length === 2) {
      nums.sort((a, b) => a - b);
      stars.sort((a, b) => a - b);
      draws.push({ date, nums, stars });
    }
  }

  return draws;
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
  const currentYear   = new Date().getFullYear();

  console.log(`Fichier cible     : ${filePath}`);
  console.log(`Tirages existants : ${existingDates.size}`);

  const url  = `${BASE_URL}/results-history-${currentYear}`;
  console.log(`Scraping          : ${url}`);

  const html  = await fetchPage(url);
  const draws = parseResultsPage(html);

  if (draws.length === 0) {
    console.error('Aucun tirage extrait — structure HTML inattendue.');
    process.exit(1);
  }

  console.log(`Tirages trouvés sur la page : ${draws.length}`);

  const sorted = draws.sort((a, b) => b.date.localeCompare(a.date));
  let added = 0;

  for (const draw of sorted) {
    if (existingDates.has(draw.date)) continue;
    const row = [draw.date, ...draw.nums, ...draw.stars].join(',');
    appendRow(filePath, row);
    console.log(`Nouveau tirage ajouté : ${row}`);
    added++;
    break;
  }

  if (added === 0) console.log('Données déjà à jour — aucun nouveau tirage.');
}

main().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
