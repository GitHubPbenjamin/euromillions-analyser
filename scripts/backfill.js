/**
 * backfill.js
 * Télécharge tous les tirages entre deux dates et les ajoute à draws.csv.
 * Utilise le fetch natif de Node 24 — aucune dépendance externe.
 *
 * Usage :
 *   node backfill.js --from 2021-01-01 --to 2024-12-31
 *   node backfill.js --from 2004-02-13          (depuis le tout premier tirage)
 */

import fs       from 'fs';
import path     from 'path';
import minimist from 'minimist';

const API_BASE  = 'https://euromillions.api.pedromealha.dev/v1';
const DATA_FILE = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';
const DELAY_MS  = 300;   // pause entre requêtes pour ne pas surcharger l'API

/* ── Helpers ───────────────────────────────────────────── */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function readExistingDates(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  return new Set(lines.slice(1).map(l => l.split(',')[0]));
}

function drawToRow(draw) {
  const nums  = [...draw.numbers].sort((a, b) => a - b);
  const stars = [...draw.stars].sort((a, b) => a - b);
  return [draw.date, ...nums, ...stars].join(',');
}

function sortAndWrite(filePath, rows) {
  rows.sort((a, b) => a.localeCompare(b));   // tri chronologique
  const content = [CSV_HEADER, ...rows].join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

/* ── Fetch avec retry ──────────────────────────────────── */

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        console.warn(`Rate-limit (429) — attente 5s (tentative ${attempt})`);
        await sleep(5000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Erreur réseau, retry dans 2s (tentative ${attempt}): ${err.message}`);
      await sleep(2000);
    }
  }
}

/* ── Collecte par année ────────────────────────────────── */

async function fetchDrawsByYear(year) {
  const data = await fetchWithRetry(`${API_BASE}/draws?year=${year}`);
  return Array.isArray(data) ? data : (data.draws ?? data.results ?? []);
}

/* ── Main ──────────────────────────────────────────────── */

async function main() {
  const args     = minimist(process.argv.slice(2));
  const fromDate = args.from ?? '2021-01-01';
  const toDate   = args.to   ?? new Date().toISOString().slice(0, 10);
  const filePath = path.resolve(DATA_FILE);

  const fromYear = parseInt(fromDate.slice(0, 4));
  const toYear   = parseInt(toDate.slice(0, 4));

  console.log(`Backfill du ${fromDate} au ${toDate} (${fromYear}–${toYear})`);
  console.log(`Fichier cible : ${filePath}`);

  const existingDates = readExistingDates(filePath);
  console.log(`Tirages déjà présents : ${existingDates.size}`);

  const allRows = existingDates.size > 0
    ? fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1)
    : [];

  let added = 0;
  let skipped = 0;

  for (let year = fromYear; year <= toYear; year++) {
    console.log(`\nAnnée ${year}...`);

    let draws;
    try {
      draws = await fetchDrawsByYear(year);
    } catch (err) {
      console.error(`  Impossible de récupérer ${year}: ${err.message}`);
      continue;
    }

    console.log(`  ${draws.length} tirages reçus`);

    for (const draw of draws) {
      const date = draw.date ?? draw.draw_date;
      if (!date) continue;
      if (date < fromDate || date > toDate) continue;
      if (existingDates.has(date)) { skipped++; continue; }

      const row = drawToRow({ ...draw, date });
      allRows.push(row);
      existingDates.add(date);
      added++;
    }

    await sleep(DELAY_MS);
  }

  if (added > 0) {
    sortAndWrite(filePath, allRows);
    console.log(`\nTerminé. ${added} tirages ajoutés, ${skipped} déjà présents.`);
    console.log(`Total dans le fichier : ${allRows.length} tirages.`);
  } else {
    console.log(`\nAucun nouveau tirage à ajouter (${skipped} déjà présents).`);
  }
}

main().catch(err => {
  console.error('Erreur fatale:', err.message);
  process.exit(1);
});
