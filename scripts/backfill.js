import fs      from 'fs';
import path    from 'path';
import zlib    from 'zlib';
import { Writable } from 'stream';

const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';

// URLs officielles FDJ — deux fichiers couvrent tout l'historique
const ZIP_URLS = [
  'https://media.fdj.fr/static/csv/euromillions/euromillions_200402.zip',
  'https://media.fdj.fr/static/csv/euromillions/euromillions_202002.zip',
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

async function downloadBuffer(url) {
  console.log(`Téléchargement : ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

function parseZipCSV(buffer) {
  // Format ZIP FDJ : archive contenant un CSV séparé par ";"
  // encodé en latin-1, colonnes :
  // annee_numero_de_tirage ; date_de_forclusion ; boule_1..5 ; etoile_1..2 ; ...
  // On dézippe manuellement en cherchant le contenu CSV brut

  // Localiser le Local File Header ZIP (signature 0x504B0304)
  const draws = [];
  let pos = 0;

  while (pos < buffer.length - 4) {
    // Chercher signature Local File Header
    if (buffer[pos]===0x50 && buffer[pos+1]===0x4B &&
        buffer[pos+2]===0x03 && buffer[pos+3]===0x04) {

      const compression  = buffer.readUInt16LE(pos + 8);
      const compSize     = buffer.readUInt32LE(pos + 18);
      const uncompSize   = buffer.readUInt32LE(pos + 22);
      const fnLen        = buffer.readUInt16LE(pos + 26);
      const extraLen     = buffer.readUInt16LE(pos + 28);
      const dataStart    = pos + 30 + fnLen + extraLen;
      const filename     = buffer.slice(pos + 30, pos + 30 + fnLen).toString('latin1');

      if (filename.endsWith('.csv') || filename.endsWith('.CSV')) {
        console.log(`  Fichier dans le ZIP : ${filename} (${uncompSize} octets)`);
        const compData = buffer.slice(dataStart, dataStart + compSize);

        let csvBuf;
        if (compression === 0) {
          csvBuf = compData;
        } else if (compression === 8) {
          csvBuf = zlib.inflateRawSync(compData);
        } else {
          console.warn(`  Compression ${compression} non supportée`);
          pos = dataStart + compSize;
          continue;
        }

        // Décoder en latin-1
        const csv = csvBuf.toString('latin1');
        const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) { pos = dataStart + compSize; continue; }

        const header = lines[0].split(';').map(h => h.trim().toLowerCase());
        const iDate  = header.findIndex(h => h.includes('date_de_forclusion') || h.includes('date'));
        const iB1    = header.findIndex(h => h === 'boule_1');
        const iB5    = header.findIndex(h => h === 'boule_5');
        const iE1    = header.findIndex(h => h === 'etoile_1');
        const iE2    = header.findIndex(h => h === 'etoile_2');

        console.log(`  Colonnes trouvées : date=${iDate} boule_1=${iB1} etoile_1=${iE1}`);

        if (iB1 < 0 || iE1 < 0) {
          console.warn('  Colonnes boule/etoile introuvables, skip');
          pos = dataStart + compSize;
          continue;
        }

        for (const line of lines.slice(1)) {
          const cols = line.split(';').map(c => c.trim().replace(/"/g, ''));
          if (cols.length < iE2 + 1) continue;

          // Date : format DD/MM/YYYY
          let isoDate = '';
          if (iDate >= 0 && cols[iDate]) {
            const d = cols[iDate];
            const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (m) isoDate = `${m[3]}-${m[2]}-${m[1]}`;
          }
          if (!isoDate) continue;

          const nums = [];
          for (let i = iB1; i <= iB1 + 4; i++) {
            const n = parseInt(cols[i], 10);
            if (!isNaN(n) && n >= 1 && n <= 50) nums.push(n);
          }
          const stars = [];
          for (let i = iE1; i <= iE1 + 1; i++) {
            const s = parseInt(cols[i], 10);
            if (!isNaN(s) && s >= 1 && s <= 12) stars.push(s);
          }

          if (nums.length === 5 && stars.length === 2) {
            nums.sort((a, b) => a - b);
            stars.sort((a, b) => a - b);
            draws.push({ isoDate, nums, stars });
          }
        }

        console.log(`  ${draws.length} tirages parsés depuis ${filename}`);
      }

      pos = dataStart + compSize;
    } else {
      pos++;
    }
  }

  return draws;
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
    let buf;
    try { buf = await downloadBuffer(url); }
    catch (err) { console.warn(`  Impossible de télécharger : ${err.message}`); continue; }

    const draws = parseZipCSV(buf);

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
