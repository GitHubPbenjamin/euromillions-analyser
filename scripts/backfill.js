import fs   from 'fs';
import path from 'path';

const BASE       = 'https://www.lesbonsnumeros.com';
const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';
const DELAY_MS   = 1500;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': 'https://www.lesbonsnumeros.com/',
};

const MOIS_FR = [
  '','janvier','fevrier','mars','avril','mai','juin',
  'juillet','aout','septembre','octobre','novembre','decembre'
];

const MOIS_ISO = {
  'janvier':1,'fevrier':2,'mars':3,'avril':4,'mai':5,'juin':6,
  'juillet':7,'aout':8,'septembre':9,'octobre':10,'novembre':11,'decembre':12
};

function removeDiacritics(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const r = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { r[args[i].slice(2)] = args[i+1] ?? true; i++; }
  }
  return r;
}

function readExistingDates(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  return new Set(fs.readFileSync(filePath,'utf8').trim().split('\n').slice(1).map(l=>l.split(',')[0]));
}

function sortAndWrite(filePath, rows) {
  rows.sort((a,b)=>a.localeCompare(b));
  fs.writeFileSync(filePath, [CSV_HEADER,...rows].join('\n')+'\n','utf8');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (err) {
      console.warn(`  Retry ${attempt}/${retries}: ${err.message}`);
      if (attempt < retries) await sleep(3000 * attempt);
      else return null;
    }
  }
}

function parseMonthPage(html) {
  const draws = [];

  // Trouver toutes les URLs de tirages individuels
  // Pattern : rapports-tirage-{id}-{jour}-{dd}-{mois}-{yyyy}.htm
  const urlRe = /rapports-tirage-(\d+)-(\w+)-(\d{1,2})-(\w+)-(\d{4})\.htm/g;
  let match;

  while ((match = urlRe.exec(html)) !== null) {
    const dd   = match[3].padStart(2, '0');
    const mois = removeDiacritics(match[4].toLowerCase());
    const yyyy = match[5];

    const moisNum = MOIS_ISO[mois];
    if (!moisNum) continue;
    const isoDate = `${yyyy}-${String(moisNum).padStart(2,'0')}-${dd}`;

    // Extraire les 7 numéros qui suivent cette URL dans le HTML
    const pos    = match.index + match[0].length;
    const bloc   = html.slice(pos, pos + 600);
    const numRe  = /<li>(\d{1,2})<\/li>/g;
    const found  = [];
    let m;
    while ((m = numRe.exec(bloc)) !== null && found.length < 7) {
      found.push(parseInt(m[1], 10));
    }

    if (found.length < 7) continue;

    const nums  = found.slice(0,5).sort((a,b)=>a-b);
    const stars = found.slice(5,7).sort((a,b)=>a-b);
    draws.push({ isoDate, nums, stars });
  }

  return draws;
}

async function main() {
  const args     = parseArgs();
  const fromYear = parseInt(args.from ?? new Date().getFullYear());
  const toYear   = parseInt(args.to   ?? new Date().getFullYear());
  const filePath = path.resolve(DATA_FILE);

  console.log(`Backfill ${fromYear} → ${toYear}`);
  const existingDates = readExistingDates(filePath);
  const allRows = existingDates.size > 0
    ? fs.readFileSync(filePath,'utf8').trim().split('\n').slice(1)
    : [];
  console.log(`Tirages existants : ${existingDates.size}`);

  let added = 0;
  const now = new Date();

  for (let year = fromYear; year <= toYear; year++) {
    for (let month = 1; month <= 12; month++) {
      if (year > now.getFullYear()) break;
      if (year === now.getFullYear() && month > now.getMonth() + 1) break;

      const moisFr = MOIS_FR[month];
      const url    = `${BASE}/euromillions/resultats/tirages-${moisFr}-${year}.htm`;
      process.stdout.write(`${moisFr} ${year} : `);

      const html = await fetchPage(url);
      if (!html) { console.log('introuvable'); await sleep(DELAY_MS); continue; }

      const draws = parseMonthPage(html);
      console.log(`${draws.length} tirages`);
if (draws.length === 0 && year === fromYear && month === 1) {
  const snippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800);
  console.log('DEBUG HTML:', snippet);
}

      for (const draw of draws) {
        if (existingDates.has(draw.isoDate)) continue;
        const row = [draw.isoDate, ...draw.nums, ...draw.stars].join(',');
        allRows.push(row);
        existingDates.add(draw.isoDate);
        added++;
      }

      await sleep(DELAY_MS);
    }
  }

  if (added > 0) {
    sortAndWrite(filePath, allRows);
    console.log(`\nTerminé : ${added} ajoutés, total ${allRows.length}`);
  } else {
    console.log('\nAucun nouveau tirage.');
  }
}

main().catch(err => { console.error('Erreur :', err.message); process.exit(1); });
