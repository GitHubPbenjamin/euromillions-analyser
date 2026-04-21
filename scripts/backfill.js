import fs   from 'fs';
import path from 'path';
import zlib from 'zlib';

const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';

const ZIP_URLS = [
  'https://cdn-media.fdj.fr/static-draws/csv/euromillions/euromillions_200402.zip',
  'https://cdn-media.fdj.fr/static-draws/csv/euromillions/euromillions_202002.zip',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Accept': '*/*',
  'Referer': 'https://www.fdj.fr/',
};

function readExistingDates(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  return new Set(
    fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1).map(l => l.split(',')[0])
  );
}

function sortAndWrite(filePath, rows) {
  rows.sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(filePath, [CSV_HEADER, ...rows].join('\n') + '\n', 'utf8');
}

function parseDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  // Format DD/MM/YYYY
  let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Format YYYYMMDD
  m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function parseCSV(csvText) {
  const draws = [];
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return draws;

  const header = lines[0].split(';').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  console.log(`  Colonnes : ${header.slice(0, 10).join(', ')}`);

  // Trouver les bonnes colonnes
  const iDate = header.findIndex(h => h === 'date_de_tirage');
  const iB1   = header.findIndex(h => h === 'boule_1');
  const iB2   = header.findIndex(h => h === 'boule_2');
  const iB3   = header.findIndex(h => h === 'boule_3');
  const iB4   = header.findIndex(h => h === 'boule_4');
  const iB5   = header.findIndex(h => h === 'boule_5');
  const iE1   = header.findIndex(h => h === 'etoile_1');
  const iE2   = header.findIndex(h => h === 'etoile_2');

  console.log(`  Index : date=${iDate} b1=${iB1} b5=${iB5} e1=${iE1} e2=${iE2}`);

  if (iB1 < 0 || iE1 < 0 || iDate < 0) {
    console.log('  Colonnes manquantes, skip');
    return draws;
  }

  for (const line of lines.slice(1)) {
    const cols = line.split(';').map(c => c.trim().replace(/"/g, ''));
    const isoDate = parseDate(cols[iDate]);
    if (!isoDate) continue;

    const nums = [iB1, iB2, iB3, iB4, iB5]
      .map(i => parseInt(cols[i], 10))
      .filter(n => !isNaN(n) && n >= 1 && n <= 50);

    const stars = [iE1, iE2]
      .map(i => parseInt(cols[i], 10))
      .filter(s => !isNaN(s) && s >= 1 && s <= 12);

    if (nums.length === 5 && stars.length === 2) {
      nums.sort((a, b) => a - b);
      stars.sort((a, b) => a - b);
      draws.push({ isoDate, nums, stars });
    }
  }

  return draws;
}

function extractCSVFromZip(buffer) {
  const allDraws = [];
  let pos = 0;

  while (pos < buffer.length - 4) {
    if (buffer[pos]===0x50 && buffer[pos+1]===0x4B &&
        buffer[pos+2]===0x03 && buffer[pos+3]===0x04) {

      const compression = buffer.readUInt16LE(pos + 8);
      const compSize    = buffer.readUInt32LE(pos + 18);
      const fnLen       = buffer.readUInt16LE(pos + 26);
      const extraLen    = buffer.readUInt16LE(pos + 28);
      const dataStart   = pos + 30 + fnLen + extraLen;
      const filename    = buffer.slice(pos + 30, pos + 30 + fnLen).toString('latin1');

      if (filename.toLowerCase().endsWith('.csv')) {
        console.log(`  Extraction de : ${filename}`);
        const compData = buffer.slice(dataStart, dataStart + compSize);
        const csvBuf   = compression === 8 ? zlib.inflateRawSync(compData) : compData;
        const draws    = parseCSV(csvBuf.toString('latin1'));
        console.log(`  ${draws.length} tirages parsés`);
        allDraws.push(...draws);
      }

      pos = dataStart + compSize;
    } else {
      pos++;
    }
  }

  return allDraws;
}

async function main() {
  const filePath      = path.resolve(DATA_FILE);
  const existingDates = readExistingDates(filePath);
  const allRows       = existingDates.size > 0
    ? fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1)
    : [];

  console.log(`Fichier : ${filePath}`);
  console.log(`Tirages existants : ${existingDates.size}`);

  let added = 0;

  for (const url of ZIP_URLS) {
    console.log(`\nTéléchargement : ${url}`);
    let buf;
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      console.log(`  ${buf.length} octets reçus`);
    } catch (err) {
      console.warn(`  Erreur : ${err.message}`);
      continue;
    }

    const draws = extractCSVFromZip(buf);

    for (const draw of draws) {
      if (existingDates.has(draw.isoDate)) continue;
      const row = [draw.isoDate, ...draw.nums, ...draw.stars].join(',');
      allRows.push(row);
      existingDates.add(draw.isoDate);
      added++;
    }
  }

  if (added > 0) {
    sortAndWrite(filePath, allRows);
    console.log(`\nTerminé : ${added} tirages ajoutés. Total : ${allRows.length}`);
  } else {
    console.log('\nAucun nouveau tirage à ajouter.');
  }
}

main().catch(err => { console.error('Erreur :', err.message); process.exit(1); });
