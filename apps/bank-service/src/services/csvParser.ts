import { createHash } from 'crypto';
import { BankTransaction } from './camtParser';

/**
 * Suomalaisten pankkien CSV-tiliotteet (Nordea, OP, S-Pankki, Danske, Aktia/POP ym.).
 * Sarakkeet tunnistetaan otsikkoriviltä nimen perusteella, joten pankkikohtaista
 * jäsennintä ei tarvita: erotin ; , tai sarkain, desimaalipilkku, pvm d.m.yyyy tai ISO.
 */

type Field = 'date' | 'amount' | 'deposit' | 'withdrawal' | 'payer' | 'payee' | 'party' | 'reference' | 'message' | 'archiveId' | 'iban' | 'currency';

// Otsikon normalisoitu muoto -> kenttä. Tarkimmat ensin (esim. "saajan tilinumero" ennen "saaja").
const HEADER_RULES: [RegExp, Field][] = [
  [/^(kirjauspaiva|kirjauspvm|kirjattu|pvm|paivamaara|tapahtumapaiva|booking ?date|date)$/, 'date'],
  [/^(maara( euroa)?|summa|rahamaara|maara eur|amount)$/, 'amount'],
  [/^(pano|panot|talletus|credit)$/, 'deposit'],
  [/^(otto|otot|nosto|debit)$/, 'withdrawal'],
  [/^(saajan )?(tilinumero|iban)$|^saajan tili$|^vastatili$/, 'iban'],
  [/^(maksaja|maksajan nimi)$/, 'payer'],
  [/^(maksunsaaja|saaja|saajan nimi)$/, 'payee'],
  [/^(saaja\/maksaja|maksaja\/saaja|nimi|vastapuoli|saaja maksaja)$/, 'party'],
  [/^(viite|viitenumero|viitenro|reference)$/, 'reference'],
  [/^(viesti|selitys|otsikko|lisatiedot|message)$/, 'message'],
  [/^(arkistointitunnus|arkistotunnus|arkistointitunniste|archive ?id)$/, 'archiveId'],
  [/^(valuutta|currency)$/, 'currency'],
];

const normalizeHeader = (h: string) =>
  h.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/å/g, 'a').replace(/["']/g, '').replace(/\s+/g, ' ').trim();

/** Pankin tiedosto voi olla UTF-8 tai ISO-8859-1 (esim. OP). */
export const decodeStatement = (buffer: Buffer): string => {
  const utf8 = buffer.toString('utf-8');
  const text = utf8.includes('�') ? buffer.toString('latin1') : utf8;
  return text.replace(/^﻿/, '');
};

const detectDelimiter = (headerLine: string): string => {
  const counts = [';', '\t', ','].map((d) => [d, headerLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
};

/** Yksinkertainen CSV-rivijako lainausmerkkien kanssa. */
const splitRow = (line: string, delimiter: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
};

/** "-1 452,36", "1.452,36", "-12.50", "+250,00" -> numero. NaN jos ei kelvollinen. */
export const parseFinnishAmount = (raw: string): number => {
  let s = (raw || '').replace(/[\s €]|EUR/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // 1.452,36
  return Number(s);
};

/** 5.10.2026, 05.10.26, 2026-10-05, 2026/10/05, 20261005 -> YYYY-MM-DD (null jos ei kelvollinen). */
export const parseFinnishDate = (raw: string): string | null => {
  const s = (raw || '').trim();
  let y: number, m: number, d: number;
  let match;
  if ((match = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else if ((match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
};

/**
 * Tunniste riville, jolla ei ole arkistointitunnusta: sisällön tiiviste + järjestysnumero saman
 * sisällön rivien kesken. Sama tiedosto (tai päällekkäinen tiliote) tuottaa samat tunnisteet,
 * joten accounting-service ei kirjaa tapahtumia kahdesti.
 */
export const syntheticEntryRef = (prefix: string, tx: Pick<BankTransaction, 'bookingDate' | 'amount' | 'creditDebit' | 'counterpartyName' | 'referenceNumber' | 'remittanceInfo'>, occurrence: number) => {
  const key = [tx.bookingDate, tx.creditDebit, tx.amount.toFixed(2), tx.counterpartyName || '', tx.referenceNumber || '', tx.remittanceInfo || '', occurrence].join('|');
  return `${prefix}-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
};

/** Lisää tunnisteet riveille, joilta arkistointitunnus puuttuu (CSV ja PDF). */
export const assignEntryRefs = (transactions: BankTransaction[], prefix: string): BankTransaction[] => {
  const seen = new Map<string, number>();
  return transactions.map((tx) => {
    if (tx.entryReference) return tx;
    const base = syntheticEntryRef(prefix, tx, 0);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...tx, entryReference: n === 0 ? base : syntheticEntryRef(prefix, tx, n) };
  });
};

export class CsvFormatError extends Error {}

export const parseBankCsv = (text: string): BankTransaction[] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  // Otsikkorivi: ensimmäinen rivi, jolta löytyy päivämäärä- ja summasarake (osa pankeista lisää alkuun tilitiedot)
  let headerIndex = -1;
  let delimiter = ';';
  let columns: (Field | null)[] = [];
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const d = detectDelimiter(lines[i]);
    const cols = splitRow(lines[i], d).map((h) => {
      const n = normalizeHeader(h);
      return HEADER_RULES.find(([re]) => re.test(n))?.[1] ?? null;
    });
    if (cols.includes('date') && (cols.includes('amount') || cols.includes('deposit') || cols.includes('withdrawal'))) {
      headerIndex = i; delimiter = d; columns = cols;
      break;
    }
  }
  if (headerIndex < 0) {
    throw new CsvFormatError('CSV-tiliotteen otsikkoriviä ei tunnistettu: tarvitaan ainakin päivämäärä- ja summasarake (esim. Kirjauspäivä; Määrä)');
  }

  const col = (row: string[], f: Field) => {
    const i = columns.indexOf(f);
    return i >= 0 ? row[i] ?? '' : '';
  };

  const transactions: BankTransaction[] = [];
  for (const [n, line] of lines.slice(headerIndex + 1).entries()) {
    const row = splitRow(line, delimiter);
    const bookingDate = parseFinnishDate(col(row, 'date'));
    if (!bookingDate) continue; // summarivit, tyhjät ja saldorivit ohitetaan

    let amount = parseFinnishAmount(col(row, 'amount'));
    if (Number.isNaN(amount)) {
      const dep = parseFinnishAmount(col(row, 'deposit'));
      const wd = parseFinnishAmount(col(row, 'withdrawal'));
      amount = !Number.isNaN(dep) && dep !== 0 ? Math.abs(dep) : !Number.isNaN(wd) ? -Math.abs(wd) : NaN;
    }
    if (Number.isNaN(amount) || amount === 0) {
      throw new CsvFormatError(`Rivi ${headerIndex + n + 2}: summaa ei voitu lukea (${col(row, 'amount') || '-'})`);
    }
    const creditDebit: 'CRDT' | 'DBIT' = amount > 0 ? 'CRDT' : 'DBIT';
    // Erilliset maksaja/saaja-sarakkeet (Nordea, S-Pankki): vastapuoli valitaan suunnan mukaan
    const counterpartyName = (creditDebit === 'CRDT' ? col(row, 'payer') : col(row, 'payee')) || col(row, 'party')
      || col(row, 'payee') || col(row, 'payer') || undefined;
    const reference = col(row, 'reference').replace(/\s+/g, '') || undefined;

    transactions.push({
      bookingDate,
      amount: Math.round(Math.abs(amount) * 100) / 100,
      currency: col(row, 'currency') || 'EUR',
      creditDebit,
      referenceNumber: reference,
      counterpartyName,
      payerName: counterpartyName,
      payerIban: col(row, 'iban').replace(/\s+/g, '') || undefined,
      remittanceInfo: col(row, 'message') || undefined,
      entryReference: col(row, 'archiveId') || undefined,
    });
  }
  return assignEntryRefs(transactions, 'CSV');
};
