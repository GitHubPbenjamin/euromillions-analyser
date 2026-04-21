import fs   from 'fs';
import path from 'path';
import zlib from 'zlib';

const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';
const DELAY_MS   = 1000;

const HEADERS_FDJ = {
  'User-Agent': 'Mozilla/5.0',
  'Accept': '*/*',
  'Referer': 'https://www.fdj.fr/',
};

const HEADERS_WEB = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept': 'text/html',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': 'https://www.lesbonsnumeros.com/',
};

const MOIS_FR = ['','janvier','fevrier','mars','avril','mai','juin',
                 'juillet','aout','septembre','octobre','novembre','decembre'];
const MOIS_ISO = {
  'janvier':1,'fevrier':2,'mars':3,'avril':4,'mai':5,'juin':6,
  'juillet':7,'aout':8,'septembre':9,'octobre':10,'novembre':11,'decembre':12
};

function removeDiacritics(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const r = {};
  for (let i=0;i<args.length;i++) {
    if (args[i].startsWith('--')) { r[args[i].slice(2)] = args[i+1]??true; i++; }
  }
  return r;
}

function readCSV(filePath) {
  if (!fs.existsSync(filePath)) return { dates: new Set(), rows: [] };
  const lines = fs.readFileSync(filePath,'utf8').trim().split('\n').slice(1);
  const dates = new Set(lines.map(l=>l.split(',')[0]));
  return { dates, rows: lines };
}

function sortAndWrite(filePath, rows) {
  rows.sort((a,b)=>a.localeCompare(b));
  fs.writeFileSync(filePath, [CSV_HEADER,...rows].join('\n')+'\n','utf8');
}

function parseDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function fetchBuf(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── ZIP FDJ ────────────────────────────────────────────

function parseCSV(text) {
  const draws = [];
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  if (lines.length < 2) return draws;
  const header = lines[0].split(';').map(h=>removeDiacritics(h.trim().toLowerCase()).replace(/[^a-z0-9_]/g,'_'));
  const iDate = header.findIndex(h=>h==='date_de_tirage');
  const iB1   = header.findIndex(h=>h==='boule_1');
  const iE1   = header.findIndex(h=>h==='etoile_1');
  const iE2   = header.findIndex(h=>h==='etoile_2');
  if (iDate<0||iB1<0||iE1<0) return draws;
  for (const line of lines.slice(1)) {
    const cols = line.split(';').map(c=>c.trim().replace(/"/g,''));
    const isoDate = parseDate(cols[iDate]);
    if (!isoDate) continue;
    const nums  = [0,1,2,3,4].map(i=>parseInt(cols[iB1+i],10)).filter(n=>n>=1&&n<=50);
    const stars = [iE1,iE2].map(i=>parseInt(cols[i],10)).filter(s=>s>=1&&s<=12);
    if (nums.length===5&&stars.length===2) {
      nums.sort((a,b)=>a-b); stars.sort((a,b)=>a-b);
      draws.push({isoDate,nums,stars});
    }
  }
  return draws;
}

function extractZip(buffer) {
  const draws = [];
  let pos = 0;
  while (pos < buffer.length-4) {
    if (buffer[pos]===0x50&&buffer[pos+1]===0x4B&&buffer[pos+2]===0x03&&buffer[pos+3]===0x04) {
      const compression = buffer.readUInt16LE(pos+8);
      const compSize    = buffer.readUInt32LE(pos+18);
      const fnLen       = buffer.readUInt16LE(pos+26);
      const extraLen    = buffer.readUInt16LE(pos+28);
      const dataStart   = pos+30+fnLen+extraLen;
      const filename    = buffer.slice(pos+30,pos+30+fnLen).toString('latin1');
      if (filename.toLowerCase().endsWith('.csv')) {
        const comp = buffer.slice(dataStart,dataStart+compSize);
        const csv  = (compression===8?zlib.inflateRawSync(comp):comp).toString('latin1');
        const d    = parseCSV(csv);
        console.log(`  ZIP "${filename}" : ${d.length} tirages`);
        draws.push(...d);
      }
      pos = dataStart+compSize;
    } else { pos++; }
  }
  return draws;
}

async function loadFDJZips() {
  const BASE = 'https://cdn-media.fdj.fr/static-draws/csv/euromillions/';
  // Essayer des noms de fichiers plausibles pour les périodes récentes
  const candidates = [
    'euromillions_200402.zip',
    'euromillions_202002.zip',
    'euromillions_202407.zip',
    'euromillions_202408.zip',
    'euromillions_202501.zip',
    'euromillions_202502.zip',
    'euromillions_202503.zip',
  ];
  const allDraws = [];
  for (const name of candidates) {
    const url = BASE + name;
    try {
      const buf = await fetchBuf(url, HEADERS_FDJ);
      console.log(`\nZIP ${name} : ${buf.length} octets`);
      allDraws.push(...extractZip(buf));
    } catch (err) {
      if (!err.message.includes('404')) {
        console.log(`  ${name} : ${err.message}`);
      }
    }
    await sleep(500);
  }
  return allDraws;
}

// ── Scraping lesbonsnumeros (pour les tirages récents) ─

function parseMonthHTML(html) {
  const draws = [];
  const urlRe = /rapports-tirage-(\d+)-(\w+)-(\d{1,2})-(\w+)-(\d{4})\.htm/g;
  let match;
  while ((match=urlRe.exec(html))!==null) {
    const dd   = match[3].padStart(2,'0');
    const mois = removeDiacritics(match[4].toLowerCase());
    const yyyy = match[5];
    const moisNum = MOIS_ISO[mois];
    if (!moisNum) continue;
    const isoDate = `${yyyy}-${String(moisNum).padStart(2,'0')}-${dd}`;
    const pos  = match.index+match[0].length;
    const bloc = html.slice(pos,pos+600);
    const numRe = /<li>(\d{1,2})<\/li>/g;
    const found = [];
    let m;
    while ((m=numRe.exec(bloc))!==null&&found.length<7) found.push(parseInt(m[1],10));
    if (found.length<7) continue;
    const nums  = found.slice(0,5).sort((a,b)=>a-b);
    const stars = found.slice(5,7).sort((a,b)=>a-b);
    draws.push({isoDate,nums,stars});
  }
  return draws;
}

async function scrapeRecentDraws(fromDate) {
  const draws = [];
  const from  = new Date(fromDate);
  const now   = new Date();
  console.log(`\nScraping lesbonsnumeros depuis ${fromDate}...`);

  for (let y=from.getFullYear();y<=now.getFullYear();y++) {
    const mStart = (y===from.getFullYear()) ? from.getMonth()+1 : 1;
    const mEnd   = (y===now.getFullYear())  ? now.getMonth()+1  : 12;
    for (let m=mStart;m<=mEnd;m++) {
      const moisFr = MOIS_FR[m];
      const url    = `https://www.lesbonsnumeros.com/euromillions/resultats/tirages-${moisFr}-${y}.htm`;
      try {
        const res  = await fetch(url,{headers:HEADERS_WEB});
        if (!res.ok) { await sleep(DELAY_MS); continue; }
        const html = await res.text();
        const d    = parseMonthHTML(html);
        console.log(`  ${moisFr} ${y} : ${d.length} tirages`);
        draws.push(...d);
      } catch (err) {
        console.log(`  ${moisFr} ${y} : erreur (${err.message})`);
      }
      await sleep(DELAY_MS);
    }
  }
  return draws;
}

// ── Main ───────────────────────────────────────────────

async function main() {
  const args     = parseArgs();
  const filePath = path.resolve(DATA_FILE);
  const {dates:existingDates, rows:allRows} = readCSV(filePath);

  console.log(`Fichier : ${filePath}`);
  console.log(`Tirages existants : ${existingDates.size}`);

  let added = 0;

  function addDraws(draws) {
    for (const d of draws) {
      if (existingDates.has(d.isoDate)) continue;
      allRows.push([d.isoDate,...d.nums,...d.stars].join(','));
      existingDates.add(d.isoDate);
      added++;
    }
  }

  // 1. ZIPs FDJ (historique + éventuels nouveaux ZIPs)
  const fdjDraws = await loadFDJZips();
  console.log(`\nTotal ZIPs FDJ : ${fdjDraws.length} tirages bruts`);
  addDraws(fdjDraws);
  console.log(`Après ZIPs FDJ : ${added} nouveaux`);

  // 2. Scraping pour les tirages manquants récents
  // Trouver la dernière date dans le CSV
  const sortedDates = [...existingDates].sort();
  const lastDate = sortedDates[sortedDates.length-1];
  console.log(`Dernière date en base : ${lastDate}`);

  if (lastDate) {
    // Scraper depuis le mois de la dernière date
    const recentDraws = await scrapeRecentDraws(lastDate);
    console.log(`\nTotal scraping : ${recentDraws.length} tirages bruts`);
    addDraws(recentDraws);
    console.log(`Après scraping : ${added} nouveaux au total`);
  }

  if (added > 0) {
    sortAndWrite(filePath, allRows);
    console.log(`\nTerminé : ${added} tirages ajoutés. Total : ${allRows.length}`);
  } else {
    console.log('\nAucun nouveau tirage.');
  }
}

main().catch(err=>{console.error('Erreur :',err.message);process.exit(1);});
