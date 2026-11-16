/**
 * Pankkiviivakoodi / virtuaaliviivakoodi (Finanssiala, versiot 4 ja 5).
 * Osakas kopioi 54-merkkisen koodin verkkopankkiin: saajan tili, summa, viite ja eräpäivä täyttyvät valmiiksi.
 *
 * Versio 4 (kotimainen viite): 4 + IBAN-numerot (16) + eurot (6) + sentit (2) + 000 + viite (20, etunollat) + eräpäivä VVKKPP
 * Versio 5 (RF-viite):         5 + IBAN-numerot (16) + eurot (6) + sentit (2) + RF-tarkiste (2) + viite (21, etunollat) + VVKKPP
 * Summa yli 999 999,99 € tai puuttuva eräpäivä => summa/eräpäivä nollina (maksaja syöttää itse).
 */
export const virtualBarcode = (iban: string, amount: number, reference: string, dueDate: Date | null): string | null => {
  const acc = String(iban ?? '').replace(/\s/g, '').toUpperCase();
  if (!/^FI\d{16}$/.test(acc)) return null; // vain suomalaiset tilit
  const ref = String(reference ?? '').replace(/\s/g, '').toUpperCase();
  const cents = Math.round(Number(amount) * 100);
  const sum = Number.isFinite(cents) && cents > 0 && cents < 100_000_000 ? String(cents).padStart(8, '0') : '00000000';
  const due = dueDate && !Number.isNaN(dueDate.getTime())
    ? `${String(dueDate.getUTCFullYear()).slice(2)}${String(dueDate.getUTCMonth() + 1).padStart(2, '0')}${String(dueDate.getUTCDate()).padStart(2, '0')}`
    : '000000';
  const digits = acc.slice(2);
  if (/^RF\d{2}[0-9]{1,21}$/.test(ref)) {
    return `5${digits}${sum}${ref.slice(2, 4)}${ref.slice(4).padStart(21, '0')}${due}`;
  }
  if (!/^\d{4,20}$/.test(ref)) return null;
  return `4${digits}${sum}000${ref.padStart(20, '0')}${due}`;
};

/** Viite viiden numeron ryhmiin oikealta (1234 56789), kuten laskulla. */
export const groupReference = (ref: string) => {
  const d = String(ref ?? '').replace(/\s/g, '');
  if (/^RF/i.test(d)) return d.replace(/(.{4})/g, '$1 ').trim();
  return d.replace(/\B(?=(\d{5})+(?!\d))/g, ' ');
};
