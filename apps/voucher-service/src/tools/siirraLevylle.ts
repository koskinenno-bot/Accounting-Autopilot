/**
 * Siirtää MinIOssa olevat tositetiedostot levylle (apps/voucher-service/files), jotta ohjelma
 * toimii ilman MinIOta (palvelin). Aja kerran omalla koneella ennen varmuuskopiota ja siirtoa:
 *
 *   cd apps\voucher-service
 *   npx ts-node --transpile-only src/tools/siirraLevylle.ts
 *
 * Jokainen tiedosto tarkistetaan tiivisteellä ennen kuin tietokantaan merkitään uusi sijainti.
 * MinIOn tiedostoja ei poisteta. Voi ajaa uudelleen: jo siirretyt ohitetaan.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { prisma } from '../db';
import { LOCAL_BUCKET, downloadFromS3, localPath } from '../utils/s3';

const main = async () => {
  const files = await prisma.voucherFile.findMany({ where: { s3Bucket: { not: LOCAL_BUCKET } } });
  console.log(`Siirrettäviä tiedostoja: ${files.length}`);
  let ok = 0; const failed: string[] = [];
  for (const f of files) {
    try {
      const data = await downloadFromS3(f.s3Bucket, f.s3Key);
      const sum = createHash('sha256').update(data).digest('hex');
      if (f.checksum && sum !== f.checksum) throw new Error('tiiviste ei täsmää');
      const target = localPath(f.s3Key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.writeFileSync(target, data, { flag: 'wx' });
      else if (createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== sum) throw new Error('levyllä on eri tiedosto samalla nimellä');
      await prisma.voucherFile.update({ where: { id: f.id }, data: { s3Bucket: LOCAL_BUCKET } });
      ok++;
    } catch (err: any) {
      failed.push(`${f.filename} (${f.id}): ${err?.message || err}`);
    }
  }
  console.log(`Siirretty ${ok}/${files.length}.`);
  if (failed.length) { console.error('Epäonnistuneet:\n  ' + failed.join('\n  ')); process.exitCode = 1; }
  await prisma.$disconnect();
};

main().catch((err) => { console.error(err); process.exit(1); });
