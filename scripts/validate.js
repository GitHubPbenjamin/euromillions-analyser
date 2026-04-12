/**
 * validate.js
 * Vérifie l'intégrité de draws.csv :
 *   - format des colonnes
 *   - plages de valeurs (numéros 1–50, étoiles 1–12)
 *   - doublons de dates
 *   - ordre chronologique
 *   - numéros distincts dans chaque tirage
 */

import fs   from 'fs';
import path from 'path';

const FILE = process.argv[2] ?? '../data/draws.csv';

/* ── Règles de validation ──────────────────────────────── */

const RULES = {
  columns:     8,
  numMin:      1,
  numMax:      50,
  starMin:     1,
  starMax:     12,
  numsCount:   5,
  starsCount:  2,
};

/* ── Main ──────────────────────────────────────────────── */

function validate(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`Fichier introuvable : ${abs}`);
    process.exit(1);
  }

  const lines   = fs.readFileSync(abs, 'utf8').trim().split('\n');
  const header  = lines[0];
  const rows    = lines.slice(1);
  const errors  = [];
  const dates   = new Set();
  let prevDate  = '';

  // Vérification de l'en-tête
  if (header !== 'date,n1,n2,n3,n4,n5,s1,s2') {
    errors.push(`En-tête invalide : "${header}"`);
  }

  rows.forEach((line, i) => {
    const lineNum = i + 2;
    const parts   = line.split(',');

    // Nombre de colonnes
    if (parts.length !== RULES.columns) {
      errors.push(`Ligne ${lineNum}: ${parts.length} colonnes (attendu ${RULES.columns})`);
      return;
    }

    const [date, ...rest] = parts;
    const nums  = rest.slice(0, 5).map(Number);
    const stars = rest.slice(5, 7).map(Number);

    // Format date ISO
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`Ligne ${lineNum}: date invalide "${date}"`);
    }

    // Ordre chronologique
    if (date < prevDate) {
      errors.push(`Ligne ${lineNum}: date "${date}" avant la précédente "${prevDate}" (ordre incorrect)`);
    }
    prevDate = date;

    // Doublons de dates
    if (dates.has(date)) {
      errors.push(`Ligne ${lineNum}: date dupliquée "${date}"`);
    }
    dates.add(date);

    // Plages numéros
    nums.forEach((n, j) => {
      if (isNaN(n) || n < RULES.numMin || n > RULES.numMax) {
        errors.push(`Ligne ${lineNum}: numéro n${j+1}="${n}" hors plage [${RULES.numMin}–${RULES.numMax}]`);
      }
    });

    // Plages étoiles
    stars.forEach((s, j) => {
      if (isNaN(s) || s < RULES.starMin || s > RULES.starMax) {
        errors.push(`Ligne ${lineNum}: étoile s${j+1}="${s}" hors plage [${RULES.starMin}–${RULES.starMax}]`);
      }
    });

    // Numéros distincts
    if (new Set(nums).size !== RULES.numsCount) {
      errors.push(`Ligne ${lineNum}: numéros en double dans [${nums}]`);
    }

    // Étoiles distinctes
    if (new Set(stars).size !== RULES.starsCount) {
      errors.push(`Ligne ${lineNum}: étoiles en double dans [${stars}]`);
    }
  });

  /* ── Rapport ─────────────────────────────────────────── */

  console.log(`\nValidation de : ${abs}`);
  console.log(`Tirages       : ${rows.length}`);
  if (rows.length > 0) {
    console.log(`Premier       : ${rows[0].split(',')[0]}`);
    console.log(`Dernier       : ${rows[rows.length - 1].split(',')[0]}`);
  }

  if (errors.length === 0) {
    console.log('\n✓ Fichier valide — aucune erreur détectée.\n');
    process.exit(0);
  } else {
    console.error(`\n✗ ${errors.length} erreur(s) détectée(s) :\n`);
    errors.slice(0, 20).forEach(e => console.error('  •', e));
    if (errors.length > 20) console.error(`  ... et ${errors.length - 20} autres`);
    console.error('');
    process.exit(1);
  }
}

validate(FILE);
