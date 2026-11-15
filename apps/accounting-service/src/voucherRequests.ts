/**
 * Puuttuvien tositteiden pyyntö sähköpostilla (KPL 2:5 §: jokaisesta kirjauksesta on oltava tosite).
 * Pankista tulleelle menolle, jolle ei löytynyt ostolaskua, pyydetään kuitti tai lasku hallitukselta
 * tai toimittajalta. Vastaus tulee isännöitsijän sähköpostiin (reply-to), josta tosite tallennetaan.
 */
export interface MissingVoucher { id: string; entryDate: Date; amount: number; counterparty: string | null; description: string | null }

export const MAX_REQUEST_ROWS = 50;

const fiDate = (d: Date) => `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
const eur = (n: number) => `${n.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const buildVoucherRequest = (companyName: string, entries: MissingVoucher[], message?: string | null) => {
  const rows = [...entries].sort((a, b) => a.entryDate.getTime() - b.entryDate.getTime()).slice(0, MAX_REQUEST_ROWS);
  const lines = rows.map((e) => `- ${fiDate(e.entryDate)}  ${eur(e.amount)}  ${e.counterparty || e.description || 'pankkimeno'}`);
  const body = [
    'Hei,',
    '',
    `${companyName}: kirjanpidosta puuttuu tosite (kuitti tai lasku) seuraavista pankkitilin maksuista:`,
    '',
    ...lines,
    ...(entries.length > rows.length ? [`… ja ${entries.length - rows.length} muuta.`] : []),
    '',
    ...(message && message.trim() ? [message.trim().slice(0, 1000), ''] : []),
    'Vastaa tähän viestiin ja liitä tositteet (kuva tai PDF käy). Kiitos!',
  ].join('\n');
  const subject = `Puuttuvat tositteet: ${companyName} (${rows.length} kpl)`;
  return { subject, body, count: rows.length, ids: rows.map((r) => r.id) };
};
