import fs   from 'fs';
import path from 'path';
import zlib from 'zlib';

const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';
const ZIP_URL = 'https://cdn-media.fdj.fr/static-draws/csv/euromillions/euromillions_202002.zip';

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

function appendRow(filePath, row) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, CSV_HEADER + '\n');
  fs.appendFileSync(filePath, row + '\n');
}

function parseZipLastDraw(buffer) {
  let pos = 0;
  const draws = [];

  while (pos < buffer.length - 4) {
    if (buffer[pos]===0x50 && buffer[pos+1]===0x4B &&
        buffer[pos+2]===0x03 && buffer[pos+3]===0x04) {

      const compression = buffer.readUInt16LE(pos + 8);
      const compSize    = buffer.readUInt32LE(pos + 18);
      const fnLen       = buffer.readUInt16LE(pos + 26);
      const extraLen    = buffer.readUInt16LE(pos + 28);
      const dataStart   = pos + 30 + fnLen + extraLen;
      const filename    = buffer.slice(pos + 30, pos + 30 + fnLen).toString('latin1');

      if (filename.endsWith('.csv') || filename.endsWith('.CSV')) {
        const compData = buffer.slice(dataStart, dataStart + compSize);
        const csvBuf   = compression === 8 ? zlib.inflateRawSync(compData) : compData;
        const csv      = csvBuf.toString('latin1');
        const lines    = csv.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) { pos = dataStart + compSize; continue; }

        const header = lines[0].split(';').map(h => h.trim().toLowerCase());
        const iDate  = header.findIndex(h => h.includes('date_de_forclusion') || h.includes('date'));
        const iB1    = header.findIndex(h => h === 'boule_1');
        const iE1    = header.findIndex(h => h === 'etoile_1');

        for (const line of lines.slice(1)) {
          const cols = line.split(';').map(c => c.trim().replace(/"/g, ''));
          let isoDate = '';
          if (iDate >= 0 && cols[iDate]) {
            const m = cols[iDate].match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (m) isoDate = `${m[3]}-${m[2]}-${m[1]}`;
          }
          if (!isoDate) continue;
          const nums  = [iB1,iB1+1,iB1+2,iB1+3,iB1+4].map(i => parseInt(cols[i],10)).filter(n => n>=1&&n<=50);
          const stars = [iE1,iE1+1].map(i => parseInt(cols[i],10)).filter(s => s>=1&&s<=12);
          if (nums.length===5 && stars.length===2) {
            nums.sort((a,b)=>a-b); stars.sort((a,b)=>a-b);
            draws.push({ isoDate, nums, stars });
          }
        }
      }
      pos = dataStart + compSize;
    } else { pos++; }
  }

  // Retourner le tirage le plus récent
  return draws.sort((a,b) => b.isoDate.localeCompare(a.isoDate))[0] ?? null;
}

async function main() {
  const filePath      = path.resolve(DATA_FILE);
  const existingDates = readExistingDates(filePath);

  console.log(`Fichier : ${filePath}`);
  console.log(`Tirages existants : ${existingDates.size}`);
  console.log(`Source : ${ZIP_URL}`);

  const res = await fetch(ZIP_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf  = Buffer.from(await res.arrayBuffer());
  const draw = parseZipLastDraw(buf);

  if (!draw) { console.error('Aucun tirage parsé.'); process.exit(1); }

  console.log(`Dernier tirage : ${draw.isoDate} — ${draw.nums.join(',')} | ★${draw.stars.join(',')}`);

  if (existingDates.has(draw.isoDate)) {
    console.log('Déjà présent — rien à faire.');
    process.exit(0);
  }

  const row = [draw.isoDate, ...draw.nums, ...draw.stars].join(',');
  appendRow(filePath, row);
  console.log(`Ajouté : ${row}`);
}

main().catch(err => { console.error('Erreur :', err.message); process.exit(1); });
