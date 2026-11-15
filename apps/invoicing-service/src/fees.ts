/**
 * Vastikkeiden laskenta (puhtaat funktiot, testattavissa ilman tietokantaa).
 *
 * Vastikeperusteet ovat yhtiökohtaisia komponentteja: hoitovastike neliöiden mukaan, rahoitusvastike
 * osakkeiden mukaan, vesimaksu henkilöiden mukaan, autopaikka paikkojen mukaan tai kiinteä summa.
 * Huoneisto, joka on maksanut lainaosuutensa pois, ei maksa sen lainan rahoitusvastiketta.
 */

export type FeeBasis = 'SQM' | 'SHARES' | 'PERSONS' | 'PARKING' | 'FIXED';

export const BASIS_LABELS: Record<FeeBasis, string> = {
  SQM: '€/m²',
  SHARES: '€/osake',
  PERSONS: '€/henkilö',
  PARKING: '€/autopaikka',
  FIXED: '€/huoneisto',
};

export interface FeeComponentInput {
  id: string;
  name: string;
  basis: FeeBasis;
  unitPrice: number;
  accountNumber: string;
  /** Rahoitusvastike: lainaosuuden pois maksanut huoneisto vapautuu tästä komponentista. */
  loanCapital: boolean;
  isActive: boolean;
  /** ALV-prosentti (esim. 25.5 liiketilan vuokralle, kun yhtiö on hakeutunut verovelvolliseksi). Hinta on veroton. */
  vatRate?: number;
}

export interface ApartmentInput {
  apartment: string;          // huoneiston tunnus, esim. "A 1"
  owners: { shareholderId: string; name: string; email?: string | null }[];
  squareMeters: number;
  shares: number;
  persons: number;
  parkingSpots: number;
}

export interface FeeLine {
  componentId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  /** Rivin summa verollisena (= net + vatAmount). */
  amount: number;
  accountNumber: string;
  vatRate: number;
  vatAmount: number;
}

export interface ApartmentFee {
  apartment: string;
  recipientName: string;
  recipientEmail: string | null;
  shareholderId: string | null;
  lines: FeeLine[];
  total: number;
  /** Komponentit, joista huoneisto on vapautettu lainaosuuden pois maksun vuoksi. */
  exempted: string[];
}

const cents = (eur: number) => Math.round(eur * 100);

/** Osakenumeroiden määrä merkinnöistä kuten ["1-350", "400", "401-402"]. Virheelliset merkinnät ohitetaan. */
export const countShares = (shareNumbers: string[] | null | undefined): number => {
  let total = 0;
  for (const raw of shareNumbers ?? []) {
    for (const part of String(raw).split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
      if (!m) continue;
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : start;
      if (end >= start) total += end - start + 1;
    }
  }
  return total;
};

const quantityFor = (basis: FeeBasis, a: ApartmentInput): number => {
  switch (basis) {
    case 'SQM': return a.squareMeters;
    case 'SHARES': return a.shares;
    case 'PERSONS': return a.persons;
    case 'PARKING': return a.parkingSpots;
    case 'FIXED': return 1;
  }
};

/**
 * Kuukauden vastikkeet huoneistoittain. exemptions: huoneisto -> komponentit, joiden lainaosuus on maksettu pois.
 * Huoneisto, jolle ei synny yhtään riviä (esim. ei neliöitä eikä osakkeita), jätetään pois.
 */
export const calculateFees = (
  components: FeeComponentInput[],
  apartments: ApartmentInput[],
  exemptions: Map<string, Set<string>> = new Map(),
): ApartmentFee[] => {
  const active = components.filter((c) => c.isActive);
  const result: ApartmentFee[] = [];
  for (const a of apartments) {
    const exempt = exemptions.get(a.apartment) ?? new Set<string>();
    const lines: FeeLine[] = [];
    const exempted: string[] = [];
    for (const c of active) {
      if (c.loanCapital && exempt.has(c.id)) {
        exempted.push(c.name);
        continue;
      }
      const quantity = quantityFor(c.basis, a);
      const amountCents = cents(quantity * c.unitPrice);
      if (!(quantity > 0) || amountCents <= 0) continue;
      const vatRate = Number(c.vatRate) > 0 ? Number(c.vatRate) : 0;
      const vatCents = Math.round((amountCents * vatRate) / 100);
      lines.push({
        componentId: c.id,
        description: c.name,
        quantity,
        unitPrice: c.unitPrice,
        amount: (amountCents + vatCents) / 100,
        accountNumber: c.accountNumber,
        vatRate,
        vatAmount: vatCents / 100,
      });
    }
    if (!lines.length) continue;
    const owner = a.owners[0];
    result.push({
      apartment: a.apartment,
      recipientName: a.owners.map((o) => o.name).join(' ja ') || a.apartment,
      recipientEmail: a.owners.find((o) => o.email)?.email ?? null,
      shareholderId: owner?.shareholderId ?? null,
      lines,
      total: lines.reduce((s, l) => s + cents(l.amount), 0) / 100,
      exempted,
    });
  }
  return result.sort((x, y) => x.apartment.localeCompare(y.apartment, 'fi', { numeric: true }));
};

/**
 * Huoneiston osuus yhtiölainasta: lainan pääoma × huoneiston osakkeet / kaikki osakkeet (sentteinä pyöristettynä).
 */
export const loanShareOf = (loanAmount: number, apartmentShares: number, totalShares: number): number =>
  totalShares > 0 ? Math.round((loanAmount * apartmentShares * 100) / totalShares) / 100 : 0;

/** Kausi muodossa YYYY-MM. */
export const isPeriod = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

export const periodLabel = (period: string) => {
  const [y, m] = period.split('-');
  return `${Number(m)}/${y}`;
};

/** Oletusperusteet uudelle yhtiölle (tilinumerot taloyhtiön tilikarttapohjasta). Hinnat isännöitsijä asettaa. */
export const DEFAULT_COMPONENTS: Omit<FeeComponentInput, 'id' | 'unitPrice' | 'isActive'>[] = [
  { name: 'Hoitovastike', basis: 'SQM', accountNumber: '3000', loanCapital: false },
  { name: 'Rahoitusvastike', basis: 'SHARES', accountNumber: '3900', loanCapital: true },
  { name: 'Vesimaksu', basis: 'PERSONS', accountNumber: '3100', loanCapital: false },
  { name: 'Autopaikka', basis: 'PARKING', accountNumber: '3200', loanCapital: false },
];
