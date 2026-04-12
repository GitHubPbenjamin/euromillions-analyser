/**
 * fetch-results.js
 * Récupère le dernier tirage EuroMillions et l'ajoute à draws.csv si absent.
 * Source : https://euromillions.api.pedromealha.dev (API communautaire gratuite)
 */

import fetch from 'node-fetch';
import fs    from 'fs';
import path  from 'path';

const API_BASE  = 'https://euromillions.api.pedromealha.dev/v1';
const DATA_FILE = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';

/* ── Helpers ───────────────────────────────────────────── */

function readExistingDates(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  return new Set(lines.slice(1).map(l => l.split(',')[0]));
}

function appendRow(filePath, row) {
  const exists = fs.existsSync(filePath);
  if (!exists) fs.writeFileSync(filePath, CSV_HEADER + '\n');
  fs.appendFileSync(filePath, row + '\n');
}

function drawToRow(draw) {
  const nums  = [...draw.numbers].sort((a, b) => a - b);
  const stars = [...draw.stars].sort((a, b) => a - b);
  return [draw.date, ...nums, ...stars].join(',');
}

/* ── Fetch ─────────────────────────────────────────────── */

async function fetchLatestDraw() {
  const res = await fetch(`${API_BASE}/draws/last`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ── Main ──────────────────────────────────────────────── */

async function main() {
  const filePath     = path.resolve(DATA_FILE);
  const existingDates = readExistingDates(filePath);

  console.log(`Fichier cible    : ${filePath}`);
  console.log(`Tirages existants: ${existingDates.size}`);

  const draw = await fetchLatestDraw();
  console.log(`Dernier tirage API: ${draw.date} — numéros: ${draw.numbers} | étoiles: ${draw.stars}`);

  if (existingDates.has(draw.date)) {
    console.log('Tirage déjà présent dans le CSV. Rien à faire.');
    process.exit(0);
  }

  const row = drawToRow(draw);
  appendRow(filePath, row);
  console.log(`Nouveau tirage ajouté : ${row}`);
}

main().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
