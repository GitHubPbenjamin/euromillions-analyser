import fs   from 'fs';
import path from 'path';
import zlib from 'zlib';

const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';
const DELAY_MS   = 800;

const HEADERS_FDJ = { 'User-Agent':'Mozilla/5.0','Accept':'*/*','Referer':'https://www.fdj.fr/' };
const HEADERS_WEB = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept':'text/html,application/xhtml+xml',
  'Accept-Language':'fr-FR,fr;q=0.9',
};

function readCSV(filePath) {
  if (!fs.existsSync(filePath)) return { dates:new Set(), rows:[] };
  const lines = fs.readFileSync(filePath,'utf8').trim().split('\n').slice(1).filter(Boolean);
  return { dates:new Set(lines.map(l=>l.split(',')[0])), rows:lines };
}

function sortAndWrite(filePath, rows) {
  rows.sort((a,b)=>a.localeCompare(b));
  fs.writeFileSync(filePath,[CSV_HEADER,...rows].join('\n')+'\n','utf8');
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ── ZIPs FDJ ───────────────────────────────────────────

function parseFDJCSV(text) {
  const draws=[], lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  if (lines.length<2) return draws;
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_]/g,'_');
  const header = lines[0].split(';').map(norm);
  const iDate=header.findIndex(h=>h==='date_de_tirage');
  const iB1=header.findIndex(h=>h==='boule_1');
  const iE1=header.findIndex(h=>h==='etoile_1');
  const iE2=header.findIndex(h=>h==='etoile_2');
  if (iDate<0||iB1<0||iE1<0) return draws;
  for (const line of lines.slice(1)) {
    const cols=line.split(';').map(c=>c.trim().replace(/"/g,''));
    const raw=cols[iDate]?.trim();
    if (!raw) continue;
    let isoDate=null;
    let m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) isoDate=`${m[3]}-${m[2]}-${m[1]}`;
    m=raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) isoDate=`${m[1]}-${m[2]}-${m[3]}`;
    if (!isoDate) continue;
    const nums=[0,1,2,3,4].map(i=>parseInt(cols[iB1+i],10)).filter(n=>n>=1&&n<=50);
    const stars=[iE1,iE2].map(i=>parseInt(cols[i],10)).filter(s=>s>=1&&s<=12);
    if (nums.length===5&&stars.length===2) {
      nums.sort((a,b)=>a-b); stars.sort((a,b)=>a-b);
      draws.push({isoDate,nums,stars});
    }
  }
  return draws;
}

function extractZip(buffer) {
  const draws=[]; let pos=0;
  while (pos<buffer.length-4) {
    if (buffer[pos]===0x50&&buffer[pos+1]===0x4B&&buffer[pos+2]===0x03&&buffer[pos+3]===0x04) {
      const compression=buffer.readUInt16LE(pos+8);
      const compSize=buffer.readUInt32LE(pos+18);
      const fnLen=buffer.readUInt16LE(pos+26);
      const extraLen=buffer.readUInt16LE(pos+28);
      const dataStart=pos+30+fnLen+extraLen;
      const filename=buffer.slice(pos+30,pos+30+fnLen).toString('latin1');
      if (filename.toLowerCase().endsWith('.csv')) {
        const comp=buffer.slice(dataStart,dataStart+compSize);
        const csv=(compression===8?zlib.inflateRawSync(comp):comp).toString('latin1');
        const d=parseFDJCSV(csv);
        console.log(`  ZIP "${filename}" : ${d.length} tirages`);
        draws.push(...d);
      }
      pos=dataStart+compSize;
    } else { pos++; }
  }
  return draws;
}

async function loadFDJZips() {
  const BASE='https://cdn-media.fdj.fr/static-draws/csv/euromillions/';
  const names=['euromillions_200402.zip','euromillions_202002.zip'];
  const allDraws=[];
  for (const name of names) {
    try {
      const res=await fetch(BASE+name,{headers:HEADERS_FDJ});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf=Buffer.from(await res.arrayBuffer());
      console.log(`ZIP ${name} : ${buf.length} octets`);
      allDraws.push(...extractZip(buf));
    } catch(err) { console.log(`  ${name} : ${err.message}`); }
    await sleep(500);
  }
  return allDraws;
}

// ── tirage-euromillions.net ────────────────────────────
// data-order="20251230" contient la date YYYYMMDD
// data-order="11262934440110" contient les 7 numéros concaténés (triés)
// On parse les deux attributs data-order successifs dans chaque <tr>

function parseTirageEuromillions(html) {
  const draws = [];

  // Chaque ligne de tirage a cette structure :
  // <td data-order="20251230"><a ...>Mardi 30/12/2025</a></td>
  // <td class="nowrap" data-order="11262934440110"><span...>
  //
  // On cherche les paires : data-order date + data-order numéros

  const dateRe  = /data-order="(\d{8})"/g;
  const numsRe  = /data-order="(\d{8})">.*?data-order="(\d{10,14})"/g;

  let m;
  while ((m = numsRe.exec(html)) !== null) {
    const dateStr = m[1]; // YYYYMMDD
    const numsStr = m[2]; // numéros concaténés ex: "11262934440110"

    const isoDate = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;

    // Décoder les numéros depuis la chaîne concaténée
    // Les numéros sont triés et concaténés sans séparateur
    // On doit les extraire : 5 numéros (1-50) + 2 étoiles (1-12)
    const decoded = decodeNums(numsStr);
    if (!decoded) continue;

    draws.push({ isoDate, nums: decoded.nums, stars: decoded.stars });
  }

  return draws;
}

function decodeNums(str) {
  // La chaîne contient 7 numéros concaténés, ex: "11262934440110"
  // = 11, 26, 29, 34, 44, 01, 10
  // Tous sont sur 2 chiffres
  if (str.length < 14) return null;
  const parts = [];
  for (let i = 0; i < str.length; i += 2) {
    parts.push(parseInt(str.slice(i, i+2), 10));
  }
  if (parts.length < 7) return null;
  const nums  = parts.slice(0, 5).sort((a,b)=>a-b);
  const stars = parts.slice(5, 7).sort((a,b)=>a-b);
  if (nums.some(n=>n<1||n>50)) return null;
  if (stars.some(s=>s<1||s>12)) return null;
  return { nums, stars };
}

async function scrapeYear(year) {
  const url = `https://www.tirage-euromillions.net/euromillions/annees/annee-${year}/`;
  try {
    const res = await fetch(url, { headers: HEADERS_WEB });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const draws = parseTirageEuromillions(html);
    console.log(`  ${year} : ${draws.length} tirages`);
    return draws;
  } catch(err) {
    console.log(`  ${year} : erreur (${err.message})`);
    return [];
  }
}

// ── Main ───────────────────────────────────────────────

async function main() {
  const filePath = path.resolve(DATA_FILE);
  const { dates, rows: allRows } = readCSV(filePath);
  console.log(`Fichier : ${filePath}`);
  console.log(`Tirages existants : ${dates.size}`);

  let added = 0;
  function addDraws(draws) {
    for (const d of draws) {
      if (dates.has(d.isoDate)) continue;
      allRows.push([d.isoDate,...d.nums,...d.stars].join(','));
      dates.add(d.isoDate);
      added++;
    }
  }

  // 1. ZIPs FDJ
  console.log('\n=== ZIPs FDJ ===');
  addDraws(await loadFDJZips());
  console.log(`Après ZIPs : ${added} nouveaux`);

  // 2. tirage-euromillions.net pour années manquantes
  const lastDate = [...dates].sort().pop() || '2024-07-01';
  const fromYear = parseInt(lastDate.slice(0,4));
  const toYear   = new Date().getFullYear();
  console.log(`\n=== tirage-euromillions.net (${fromYear}–${toYear}) ===`);
  for (let y = fromYear; y <= toYear; y++) {
    addDraws(await scrapeYear(y));
    await sleep(DELAY_MS);
  }

  if (added > 0) {
    sortAndWrite(filePath, allRows);
    console.log(`\nTerminé : ${added} ajoutés. Total : ${allRows.length}`);
  } else {
    console.log('\nAucun nouveau tirage.');
  }
}

main().catch(err => { console.error('Erreur :', err.message); process.exit(1); });
