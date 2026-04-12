/**
 * backfill.js
 * Scrape euro-millions.com pour récupérer tous les tirages entre deux années.
 * Zéro dépendance externe — Node 24 natif uniquement.
 *
 * Usage :
 *   node backfill.js --from 2021 --to 2025
 *   node backfill.js --from 2004            (depuis le premier tirage)
 */

import fs   from 'fs';
import path from 'path';

const BASE_URL   = 'https://www.euro-millions.com';
const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';
const DELAY_MS   = 1500;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; euromillions-analyser/1.0)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

/* ── Args ────────────────────────────────────────────── */

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] ?? true;
      i++;
    }
  }
  return result;
}

/* ── Helpers CSV ─────────────────────────────────────── */

function readExistingDates(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  return new Set(lines.slice(1).map(l => l.split(',')[0]));
}

function sortAndWrite(filePath, rows) {
  rows.sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(filePath, [CSV_HEADER, ...rows].join('\n') + '\n', 'utf8');
}

/* ── Parsing HTML ────────────────────────────────────── */

function parseResultsPage(html) {
  const draws  = [];
  const blocks = html.split(/data-draw-date=/);

  for (const block of blocks.slice(1)) {
    const dateMatch = block.match(/^"(\d{4}-\d{2}-\d{2})"/);
    if (!dateMatch) continue;
    const date  = dateMatch[1];
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) {
        console.warn('Rate-limit (429) — attente 10s');
        await sleep(10000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (err) {
      console.warn(`Tentative ${attempt}/${retries} : ${err.message}`);
      if (attempt < retries) await sleep(3000 * attempt);
      else throw err;
    }
  }
}

/* ── Main ────────────────────────────────────────────── */

async function main() {
  const args      = parseArgs();
  const fromYear  = parseInt(args.from ?? new Date().getFullYear());
  const toYear    = parseInt(args.to   ?? new Date().getFullYear());
  const filePath  = path.resolve(DATA_FILE);

  console.log(`Backfill ${fromYear} → ${toYear}`);
  console.log(`Fichier cible : ${filePath}`);

  const existingDates = readExistingDates(filePath);
  const allRows = existingDates.size > 0
    ? fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1)
    : [];

  console.log(`Tirages déjà présents : ${existingDates.size}`);

  let added = 0;

  for (let year = fromYear; year <= toYear; year++) {
    const url = `${BASE_URL}/results-history-${year}`;
    console.log(`\nAnnée ${year} : ${url}`);

    let html;
    try {
      html = await fetchPage(url);
    } catch (err) {
      console.error(`  Impossible de scraper ${year} : ${err.message}`);
      continue;
    }

    const draws = parseResultsPage(html);
    console.log(`  ${draws.length} tirages trouvés`);

    for (const draw of draws) {
      if (existingDates.has(draw.date)) continue;
      const row = [draw.date, ...draw.nums, ...draw.stars].join(',');
      allRows.push(row);
      existingDates.add(draw.date);
      added++;
    }

    if (year < toYear) await sleep(DELAY_MS);
  }

  if (added > 0) {
    sortAndWrite(filePath, allRows);
    console.log(`\nTerminé. ${added} tirages ajoutés. Total : ${allRows.length}`);
  } else {
    console.log('\nAucun nouveau tirage — données déjà à jour.');
  }
}

main().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
