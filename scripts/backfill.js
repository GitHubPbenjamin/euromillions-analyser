import fs   from 'fs';
import path from 'path';
import zlib from 'zlib';

const URLS = [
  'https://cdn-media.fdj.fr/static-draws/csv/euromillions/euromillions_200402.zip',
  'https://cdn-media.fdj.fr/static-draws/csv/euromillions/euromillions_202002.zip',
];

async function main() {
  for (const url of URLS) {
    console.log(`\nTest : ${url}`);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.fdj.fr/' }
      });
      console.log(`  Status : ${res.status}`);
      console.log(`  Content-Type : ${res.headers.get('content-type')}`);
      console.log(`  Content-Length : ${res.headers.get('content-length')} octets`);

      if (!res.ok) { console.log('  ERREUR HTTP'); continue; }

      const buf = Buffer.from(await res.arrayBuffer());
      console.log(`  Buffer reçu : ${buf.length} octets`);

      // Vérifier signature ZIP
      const isZip = buf[0]===0x50 && buf[1]===0x4B;
      console.log(`  Signature ZIP valide : ${isZip}`);

      if (isZip) {
        // Chercher le premier fichier CSV dans le ZIP
        let pos = 0;
        while (pos < buf.length - 4) {
          if (buf[pos]===0x50 && buf[pos+1]===0x4B && buf[pos+2]===0x03 && buf[pos+3]===0x04) {
            const fnLen    = buf.readUInt16LE(pos + 26);
            const extraLen = buf.readUInt16LE(pos + 28);
            const filename = buf.slice(pos + 30, pos + 30 + fnLen).toString('latin1');
            const compSize = buf.readUInt32LE(pos + 18);
            console.log(`  Fichier ZIP : "${filename}" (${compSize} octets compressés)`);
            if (filename.toLowerCase().endsWith('.csv')) {
              const compression = buf.readUInt16LE(pos + 8);
              const dataStart   = pos + 30 + fnLen + extraLen;
              const compData    = buf.slice(dataStart, dataStart + compSize);
              const csvBuf      = compression === 8 ? zlib.inflateRawSync(compData) : compData;
              const lines       = csvBuf.toString('latin1').split('\n').filter(l => l.trim());
              console.log(`  Lignes CSV : ${lines.length}`);
              console.log(`  En-tête : ${lines[0].slice(0, 120)}`);
              console.log(`  1ère ligne : ${lines[1]?.slice(0, 120)}`);
              console.log(`  Dernière ligne : ${lines[lines.length-1]?.slice(0, 120)}`);
            }
            pos = pos + 30 + fnLen + extraLen + compSize;
          } else { pos++; }
        }
      }
    } catch (err) {
      console.log(`  EXCEPTION : ${err.message}`);
    }
  }
}

main();
