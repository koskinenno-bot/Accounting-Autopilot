import crypto from 'crypto';

/**
 * Muutoslokin tiivisteketju (puhtaat funktiot). Jokainen tapahtuma sisältää edellisen saman yhtiön tapahtuman
 * tiivisteen, joten jälkikäteen muutettu, poistettu tai väliin lisätty rivi näkyy katkoksena ketjussa.
 * Tietokantatriggeri (immutability.ts) estää lisäksi rivien muuttamisen ja poistamisen.
 */

export interface ChainFields {
  id: string;
  companyId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string | null;
  changes: unknown;
  createdAt: Date;
}

/** JSON avaimet aakkosjärjestyksessä: Postgresin jsonb ei säilytä avainten järjestystä. */
export const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const recordHash = (prevHash: string | null, f: ChainFields) =>
  crypto.createHash('sha256').update(stableStringify({
    prevHash, id: f.id, companyId: f.companyId, userId: f.userId, action: f.action, entityType: f.entityType,
    entityId: f.entityId, description: f.description, changes: f.changes ?? null, createdAt: f.createdAt.toISOString(),
  })).digest('hex');

/** Seuraavan tapahtuman aikaleima: aina edellistä myöhäisempi, jotta järjestys (createdAt, id) on yksiselitteinen. */
export const nextTimestamp = (last: Date | null, now = new Date()) =>
  last && now.getTime() <= last.getTime() ? new Date(last.getTime() + 1) : now;

export interface VerifyResult { ok: boolean; checked: number; legacy: number; brokenAt: string | null; reason: string | null }

/** Tarkistaa ketjun (rivit createdAt-järjestyksessä). Ennen ketjutusta tallennetut rivit (hash puuttuu) ohitetaan. */
export const verifyChain = (rows: (ChainFields & { prevHash: string | null; hash: string | null })[]): VerifyResult => {
  let prev: string | null = null;
  let checked = 0;
  let legacy = 0;
  for (const r of rows) {
    if (!r.hash) {
      if (prev) return { ok: false, checked, legacy, brokenAt: r.id, reason: 'Ketjutetun tapahtuman jälkeen on tapahtuma ilman tiivistettä' };
      legacy++;
      continue;
    }
    if (r.prevHash !== prev) return { ok: false, checked, legacy, brokenAt: r.id, reason: 'Edellinen tapahtuma puuttuu tai on muuttunut' };
    if (recordHash(r.prevHash, r) !== r.hash) return { ok: false, checked, legacy, brokenAt: r.id, reason: 'Tapahtuman sisältöä on muutettu' };
    prev = r.hash;
    checked++;
  }
  return { ok: true, checked, legacy, brokenAt: null, reason: null };
};
