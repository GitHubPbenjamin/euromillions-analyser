import fs   from 'fs';
import path from 'path';

const BASE       = 'https://www.lesbonsnumeros.com';
const DATA_FILE  = process.env.DATA_FILE ?? '../data/draws.csv';
const CSV_HEADER = 'date,n1,n2,n3,n4,n5,s1,s2';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': 'https://www.lesbonsnumeros.com/',
};

const JOURS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const MOIS  = ['','janvier','février','mars','avril','mai','juin',
                'juillet','août','septembre','octobre','novembre','décembre'];
const MOIS_ISO = {
  'janvier':1,'fevrier':2,'mars':3,'avril':4,'mai':5,'juin':6,
  'juillet':7,'aout':8,'septembre':9,'octobre':10,'novembre':11,'decembre':12
};

function removeDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function todayDrawInfo() {
  const now  = new Date();
  const day  = now.getDay();
  const date = now;

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const isoDate = `${yyyy}-${mm}-${dd}`;

  const jourFr   = JOURS[day];
  const moisFr   = removeDiacritics(MOIS[date.getMonth() + 1].toLowerCase());
  const moisNum  = date.getMonth() + 1;

  return { isoDate, jourFr, moisFr, moisNum, dd: date.getDate(), yyyy };
}

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

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (err) {
      console.warn(`Tentative ${attempt}/${retries} : ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
      else throw err;
    }
  }
}

function parseDrawPage(html, isoDate) {
  // Les numéros sont dans des <li> simples dans la section tirage
  // On cherche le premier bloc de 7 nombres consécutifs entre 1 et 50
  const numRe = /<li>(\d{1,2})<\/li>/g;
  const found = [];
  let m;
  while ((m = numRe.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 50) found.push(n);
    if (found.length === 7) break;
  }
  if (found.length < 7) return null;

  const nums  = found.slice(0, 5).sort((a, b) => a - b);
  const stars = found.slice(5, 7).sort((a, b) => a - b);
  return { date: isoDate, nums, stars };
}

async function searchRecentDraw() {
  // Cherche dans les 4 derniers jours un tirage mardi ou vendredi
  for (let daysBack = 0; daysBack <= 4; daysBack++) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    const dow = d.getDay();
    if (dow !== 2 && dow !== 5) continue; // seulement mardi(2) et vendredi(5)

    const dd     = d.getDate();
    const moisFr = removeDiacritics(MOIS[d.getMonth() + 1].toLowerCase());
    const yyyy   = d.getFullYear();
    const jourFr = JOURS[dow];
    const isoDate = `${yyyy}-${String(d.getMonth()+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;

    // L'URL contient un ID de tirage inconnu — on cherche via la page de liste du mois
    const moisUrl = `${BASE}/euromillions/resultats/tirages-${moisFr}-${yyyy}.htm`;
    console.log(`Recherche dans : ${moisUrl}`);

    const html = await fetchPage(moisUrl);
    if (!html) { console.log('Page mois introuvable, continuer...'); continue; }

    // Chercher l'URL du tirage pour cette date
    const dayStr  = String(dd);
    const pattern = new RegExp(`rapports-tirage-(\\d+)-${jourFr}-${dayStr}-${moisFr}-${yyyy}\\.htm`);
    const match   = html.match(pattern);

    if (!match) {
      console.log(`Tirage du ${isoDate} pas encore en ligne.`);
      continue;
    }

    const drawUrl = `${BASE}/euromillions/resultats/${match[0]}`;
    console.log(`Tirage trouvé : ${drawUrl}`);

    const drawHtml = await fetchPage(drawUrl);
    if (!drawHtml) continue;

    const draw = parseDrawPage(drawHtml, isoDate);
    if (draw) return draw;
  }
  return null;
}

async function main() {
  const filePath      = path.resolve(DATA_FILE);
  const existingDates = readExistingDates(filePath);

  console.log(`Fichier cible     : ${filePath}`);
  console.log(`Tirages existants : ${existingDates.size}`);

  const draw = await searchRecentDraw();

  if (!draw) {
    console.log('Aucun nouveau tirage disponible pour le moment.');
    process.exit(0);
  }

  console.log(`Tirage : ${draw.date} — ${draw.nums.join(',')} | ★${draw.stars.join(',')}`);

  if (existingDates.has(draw.date)) {
    console.log('Déjà présent — rien à faire.');
    process.exit(0);
  }

  const row = [draw.date, ...draw.nums, ...draw.stars].join(',');
  appendRow(filePath, row);
  console.log(`Ajouté : ${row}`);
}

main().catch(err => {
  console.error('Erreur fatale :', err.message);
  process.exit(1);
});
