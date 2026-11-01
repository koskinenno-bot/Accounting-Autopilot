/**
 * "Saapuneet"-kansion tarkkailu: tiedostot, jotka pankin oma tiedostonsiirto, sähköpostisääntö
 * tai käyttäjä tuo kansioon <INBOX_DIR>/<yhtiön tunnus>/<alikansio>/, käsitellään automaattisesti
 * ja siirretään processed/- tai failed/-alikansioon (virhe kirjataan .virhe.txt-tiedostoon).
 *
 * TÄMÄ ON KANONINEN VERSIO, kopioitu palveluihin (bank-service, voucher-service) skriptillä
 *   node scripts/sync-auth.js
 * Kysely (polling) eikä fs.watch, koska fs.watch on epäluotettava Windowsilla ja verkkolevyillä.
 */
import fs from 'fs';
import path from 'path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InboxOptions {
  /** Alikansio yhtiön kansion alla, esim. 'tiliotteet' tai 'tositteet'. */
  subfolder: string;
  /** Sallitut tiedostopäätteet (pienillä kirjaimilla, pisteen kanssa). */
  extensions: string[];
  /** Käsittelijä; heitetty virhe siirtää tiedoston failed/-kansioon. */
  handle: (companyId: string, file: { buffer: Buffer; filename: string; path: string }) => Promise<string | void>;
  intervalMs?: number;
}

export const inboxRoot = () =>
  path.resolve(process.env.INBOX_DIR || path.join(process.cwd(), '..', '..', 'inbox'));

const moveTo = (file: string, folder: 'processed' | 'failed', note?: string) => {
  const dir = path.join(path.dirname(file), folder);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `${stamp}_${path.basename(file)}`);
  fs.renameSync(file, target);
  if (note) fs.writeFileSync(`${target}.virhe.txt`, note, 'utf8');
  return target;
};

export const startInboxWatcher = (options: InboxOptions) => {
  if (process.env.INBOX_DISABLED === 'true') return;
  const root = inboxRoot();
  const interval = options.intervalMs ?? 15_000;
  let running = false;

  const scan = async () => {
    if (running || !fs.existsSync(root)) return;
    running = true;
    try {
      for (const company of fs.readdirSync(root, { withFileTypes: true })) {
        if (!company.isDirectory() || !UUID.test(company.name)) continue;
        const dir = path.join(root, company.name, options.subfolder);
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isFile() || !options.extensions.includes(path.extname(entry.name).toLowerCase())) continue;
          const file = path.join(dir, entry.name);
          // Kirjoitus voi olla kesken: käsitellään vasta, kun tiedosto ei ole muuttunut 5 sekuntiin
          if (Date.now() - fs.statSync(file).mtimeMs < 5_000) continue;
          try {
            const message = await options.handle(company.name, { buffer: fs.readFileSync(file), filename: entry.name, path: file });
            moveTo(file, 'processed');
            console.log(`[inbox] ${company.name}/${options.subfolder}/${entry.name}: ${message || 'käsitelty'}`);
          } catch (err: any) {
            moveTo(file, 'failed', err?.message || String(err));
            console.error(`[inbox] ${entry.name} epäonnistui: ${err?.message || err}`);
          }
        }
      }
    } catch (err: any) {
      console.error(`[inbox] kansion luku epäonnistui: ${err.message}`);
    } finally {
      running = false;
    }
  };

  console.log(`[inbox] tarkkaillaan ${path.join(root, '<yhtiön tunnus>', options.subfolder)} (${interval / 1000} s välein)`);
  setInterval(scan, interval);
  setTimeout(scan, 3_000);
};
