/** IBAN-tilinumeron tarkistus (ISO 13616, mod 97). Suomalainen IBAN on 18 merkkiä (FIkk + 14 numeroa). */
export const normalizeIban = (v: string) => v.replace(/\s+/g, '').toUpperCase();

export const isValidIban = (raw: unknown): boolean => {
  if (typeof raw !== 'string') return false;
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('FI') && iban.length !== 18) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const n = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
};

/** Ryhmittely neljän merkin ryhmiin näyttöä varten: FI21 1234 5600 0007 85. */
export const formatIban = (raw: string) => normalizeIban(raw).replace(/(.{4})/g, '$1 ').trim();
