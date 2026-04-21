import fs   from 'fs';
import path from 'path';

const HEADERS = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept':'text/html,application/xhtml+xml',
  'Accept-Language':'fr-FR,fr;q=0.9',
};

async function main() {
  const url = 'https://www.tirage-euromillions.net/euromillions/annees/annee-2025/';
  console.log(`Fetch : ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  console.log(`Status : ${res.status}`);
  console.log(`Content-Type : ${res.headers.get('content-type')}`);
  const html = await res.text();
  console.log(`Taille HTML : ${html.length} caractères`);

  // Chercher les numéros — différents patterns possibles
  console.log('\n--- Recherche de patterns ---');

  // Pattern tableau markdown (| date | nums |)
  const p1 = html.match(/\d{2}\/\d{2}\/\d{4}/g);
  console.log(`Dates DD/MM/YYYY trouvées : ${p1?.length ?? 0}`);
  if (p1?.length) console.log(`  Exemples : ${p1.slice(0,3).join(', ')}`);

  // Chercher des séquences de 7 nombres
  const p2 = html.match(/\d{1,2}\s+\d{1,2}\s+\d{1,2}\s+\d{1,2}\s+\d{1,2}\s+\d{1,2}\s+\d{1,2}/g);
  console.log(`Séquences de 7 nombres : ${p2?.length ?? 0}`);
  if (p2?.length) console.log(`  Exemples : ${p2.slice(0,2).join(' | ')}`);

  // Extrait brut autour du premier tableau
  const tableIdx = html.indexOf('<table');
  if (tableIdx >= 0) {
    console.log('\n--- Extrait tableau HTML (500 chars) ---');
    console.log(html.slice(tableIdx, tableIdx + 500).replace(/\s+/g,' '));
  }

  // Extrait texte brut (sans balises)
  const text = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  const dateIdx = text.indexOf('30/12/2025');
  if (dateIdx >= 0) {
    console.log('\n--- Contexte autour de 30/12/2025 ---');
    console.log(text.slice(dateIdx - 20, dateIdx + 100));
  }
}

main().catch(err => { console.error('Erreur :', err.message); process.exit(1); });
