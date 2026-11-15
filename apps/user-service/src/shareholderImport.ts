/**
 * Osakasluettelon CSV-tuonti isännöintijärjestelmästä (puhdas jäsennys, testattavissa).
 *
 * Sarakkeet tunnistetaan otsikkorivin nimistä, joten sarakejärjestyksellä ei ole väliä. Erottimeksi käy
 * puolipiste, pilkku tai sarkain; desimaalipilkku hyväksytään. Saman huoneiston useampi omistaja = useampi rivi.
 */

export interface ImportedOwner {
  name: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  businessId: string | null;
  email: string;
  phone: string | null;
}

export interface ImportedApartment {
  number: string;
  squareMeters: number;
  shareNumbers: string[];
  persons: number;
  parkingSpots: number;
  owners: ImportedOwner[];
}

export interface ImportResult {
  apartments: ImportedApartment[];
  errors: string[];
  warnings: string[];
}

const COLUMNS: Record<string, string[]> = {
  apartment: ['huoneisto', 'asunto', 'huoneistotunnus', 'apartment', 'huon'],
  sqm: ['pinta-ala', 'pintaala', 'm2', 'm²', 'neliöt', 'neliot', 'ala', 'squaremeters'],
  shares: ['osakkeet', 'osakenumerot', 'osakenrot', 'osakenro', 'shares'],
  name: ['omistaja', 'osakas', 'nimi', 'owner', 'name'],
  firstName: ['etunimi', 'firstname'],
  lastName: ['sukunimi', 'lastname'],
  businessId: ['y-tunnus', 'ytunnus', 'businessid'],
  email: ['sähköposti', 'sahkoposti', 'email', 'e-mail', 'sposti'],
  phone: ['puhelin', 'puh', 'phone', 'matkapuhelin'],
  persons: ['henkilöt', 'henkilot', 'henkilömäärä', 'henkilomaara', 'asukkaat', 'asukasmäärä', 'persons'],
  parking: ['autopaikat', 'autopaikka', 'autopaikkoja', 'parking'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/^﻿/, '').replace(/[\s_.]/g, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Yksi CSV-rivi kenttiin; lainausmerkit ("a; b") ja kahdennetut lainausmerkit tuetaan. */
export const splitCsvLine = (line: string, sep: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

const detectSeparator = (header: string) =>
  [';', '\t', ','].map((s) => [s, header.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];

const number = (v: string | undefined): number => {
  if (!v) return 0;
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export const parseShareholderCsv = (csv: string): ImportResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = csv.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { apartments: [], errors: ['Tiedostossa ei ole otsikkoriviä ja tietoja'], warnings };

  const sep = detectSeparator(lines[0]);
  const header = splitCsvLine(lines[0], sep).map(norm);
  const col: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(COLUMNS)) {
    const idx = header.findIndex((h) => aliases.map(norm).includes(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.apartment === undefined) errors.push('Sarake "Huoneisto" puuttuu');
  if (col.name === undefined && col.lastName === undefined) errors.push('Sarake "Omistaja" (tai Etunimi ja Sukunimi) puuttuu');
  if (col.sqm === undefined) warnings.push('Pinta-alaa ei ole: hoitovastiketta €/m² ei voi laskea');
  if (col.shares === undefined) warnings.push('Osakenumeroita ei ole: rahoitusvastiketta €/osake ei voi laskea');
  if (errors.length) return { apartments: [], errors, warnings };

  const map = new Map<string, ImportedApartment>();
  lines.slice(1).forEach((line, i) => {
    const rowNo = i + 2;
    const f = splitCsvLine(line, sep);
    const get = (k: string) => (col[k] !== undefined ? (f[col[k]] ?? '').trim() : '');
    const apt = get('apartment').replace(/\s+/g, ' ');
    if (!apt) { errors.push(`Rivi ${rowNo}: huoneisto puuttuu`); return; }
    const firstName = get('firstName') || null;
    const lastName = get('lastName') || null;
    const businessId = get('businessId') || null;
    const name = get('name') || [firstName, lastName].filter(Boolean).join(' ');
    if (!name) { errors.push(`Rivi ${rowNo} (${apt}): omistajan nimi puuttuu`); return; }
    const email = get('email');
    if (email && !EMAIL.test(email)) warnings.push(`Rivi ${rowNo} (${apt}): sähköposti "${email}" on virheellinen, jätetään tyhjäksi`);
    const sqm = number(get('sqm'));
    const persons = number(get('persons'));
    const parking = number(get('parking'));
    if ([sqm, persons, parking].some(Number.isNaN)) { errors.push(`Rivi ${rowNo} (${apt}): pinta-ala, henkilöt tai autopaikat ei ole numero`); return; }
    const shares = get('shares').split(/[,;]/).map((s) => s.trim().replace(/\s*[-–]\s*/, '-')).filter(Boolean);

    const row = map.get(apt) ?? { number: apt, squareMeters: 0, shareNumbers: [], persons: 0, parkingSpots: 0, owners: [] };
    row.squareMeters = row.squareMeters || sqm;
    row.persons = row.persons || persons;
    row.parkingSpots = row.parkingSpots || parking;
    if (!row.shareNumbers.length) row.shareNumbers = shares;
    row.owners.push({
      name,
      firstName: businessId ? null : firstName ?? (name.includes(' ') ? name.split(' ').slice(0, -1).join(' ') : null),
      lastName: businessId ? null : lastName ?? (name.includes(' ') ? name.split(' ').slice(-1)[0] : name),
      companyName: businessId ? name : null,
      businessId,
      email: email && EMAIL.test(email) ? email.toLowerCase() : '',
      phone: get('phone') || null,
    });
    map.set(apt, row);
  });

  const apartments = [...map.values()].sort((a, b) => a.number.localeCompare(b.number, 'fi', { numeric: true }));
  for (const a of apartments) {
    if (!a.squareMeters && col.sqm !== undefined) warnings.push(`${a.number}: pinta-ala puuttuu`);
    if (!a.owners.some((o) => o.email)) warnings.push(`${a.number}: ei sähköpostia, muistutuksia ei voi lähettää sähköpostilla`);
  }
  return { apartments, errors, warnings };
};
