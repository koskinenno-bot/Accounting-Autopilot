/**
 * Vastikereskontra: avoimet saldot, viivästyskorko ja maksumuistutukset (puhtaat funktiot).
 *
 * Viivästyskorko korkolain 4 §:n mukaan: viitekorko + 7 prosenttiyksikköä, lasketaan eräpäivää
 * seuraavasta päivästä maksupäivään (todelliset päivät / 365).
 * Maksumuistutus: perintälain mukaan kuluttajalta saa periä muistutuksesta enintään 5 €, ja
 * muistutuksessa annetaan vähintään 14 päivän maksuaika. Uutta muistutusta samasta laskusta ei
 * lähetetä ennen kuin edellisen maksuaika on kulunut.
 */

export const DAY = 86_400_000;
export const STATUTORY_MARGIN = 7; // korkolaki 4 §: viitekorko + 7 %-yksikköä
export const MAX_CONSUMER_REMINDER_FEE = 5;

export interface InvoiceForLedger {
  id: string;
  apartment: string | null;
  recipientName: string;
  kind: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  paidAmount: number;
  lastReminderAt: Date | null;
}

const toCents = (eur: number) => Math.round(eur * 100);
const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export const openAmount = (inv: Pick<InvoiceForLedger, 'totalAmount' | 'paidAmount' | 'status'>): number =>
  inv.status === 'CANCELLED' ? 0 : Math.max(0, toCents(inv.totalAmount) - toCents(inv.paidAmount)) / 100;

/** Päiviä eräpäivän yli (0, jos ei erääntynyt). */
export const daysOverdue = (dueDate: Date, today: Date): number =>
  Math.max(0, Math.floor((startOfDay(today) - startOfDay(dueDate)) / DAY));

export const lateInterestRate = (referenceRate: number) => referenceRate + STATUTORY_MARGIN;

/** Viivästyskorko euroina avoimelle määrälle eräpäivästä päivään `today`. */
export const lateInterest = (open: number, dueDate: Date, today: Date, referenceRate: number): number => {
  const days = daysOverdue(dueDate, today);
  if (days <= 0 || open <= 0) return 0;
  return Math.round(open * (lateInterestRate(referenceRate) / 100) * (days / 365) * 100) / 100;
};

export interface ReminderSettings {
  referenceRate: number;     // viitekorko %, Suomen Pankki julkaisee puolivuosittain
  reminderFee: number;       // € / muistutus, enintään 5 € kuluttajalle
  reminderDaysAfterDue: number;
  paymentTermDays: number;   // muistutuksen maksuaika, vähintään 14 pv
}

export interface ReminderCandidate {
  invoiceId: string;
  apartment: string | null;
  recipientName: string;
  dueDate: Date;
  open: number;
  daysOverdue: number;
  interest: number;
  fee: number;
  /** Muistutus voidaan lähettää nyt; muuten syy, miksi ei. */
  eligible: boolean;
  reason: string | null;
}

/** Erääntyneet vastikelaskut muistutusta varten. Muistutuslaskuista ei lähetetä uusia muistutuksia. */
export const reminderCandidates = (invoices: InvoiceForLedger[], today: Date, s: ReminderSettings): ReminderCandidate[] =>
  invoices
    .filter((inv) => inv.kind !== 'REMINDER' && openAmount(inv) > 0 && daysOverdue(inv.dueDate, today) > 0)
    .map((inv) => {
      const open = openAmount(inv);
      const overdue = daysOverdue(inv.dueDate, today);
      let reason: string | null = null;
      if (overdue < s.reminderDaysAfterDue) reason = `Eräpäivästä vasta ${overdue} pv (muistutus ${s.reminderDaysAfterDue} pv jälkeen)`;
      else if (inv.lastReminderAt && daysOverdue(inv.lastReminderAt, today) < s.paymentTermDays) {
        const r = inv.lastReminderAt;
        reason = `Muistutettu ${r.getUTCDate()}.${r.getUTCMonth() + 1}.${r.getUTCFullYear()}, maksuaika kesken`;
      }
      return {
        invoiceId: inv.id,
        apartment: inv.apartment,
        recipientName: inv.recipientName,
        dueDate: inv.dueDate,
        open,
        daysOverdue: overdue,
        interest: lateInterest(open, inv.dueDate, today, s.referenceRate),
        fee: Math.min(s.reminderFee, MAX_CONSUMER_REMINDER_FEE),
        eligible: reason === null,
        reason,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

export interface ApartmentBalance {
  apartment: string;
  recipientName: string;
  billed: number;
  paid: number;
  open: number;
  overdue: number;
  oldestDueDate: Date | null;
  invoiceCount: number;
}

/** Huoneistokohtaiset saldot (osakaskohtainen reskontra). Summat lasketaan sentteinä. */
export const apartmentBalances = (invoices: InvoiceForLedger[], today: Date): ApartmentBalance[] => {
  type Acc = { apartment: string; recipientName: string; latestIssue: Date; billed: number; paid: number; open: number;
    overdue: number; oldestDueDate: Date | null; invoiceCount: number };
  const map = new Map<string, Acc>();
  for (const inv of invoices) {
    if (inv.status === 'CANCELLED') continue;
    const key = inv.apartment ?? `(${inv.recipientName})`;
    const row = map.get(key) ?? {
      apartment: key, recipientName: inv.recipientName, latestIssue: inv.issueDate,
      billed: 0, paid: 0, open: 0, overdue: 0, oldestDueDate: null, invoiceCount: 0,
    };
    const openC = toCents(openAmount(inv));
    row.billed += toCents(inv.totalAmount);
    row.paid += toCents(inv.paidAmount);
    row.open += openC;
    row.invoiceCount += 1;
    if (inv.issueDate >= row.latestIssue) {
      row.latestIssue = inv.issueDate;
      row.recipientName = inv.recipientName; // nykyinen omistaja = uusimman laskun saaja
    }
    if (openC > 0 && daysOverdue(inv.dueDate, today) > 0) {
      row.overdue += openC;
      if (!row.oldestDueDate || inv.dueDate < row.oldestDueDate) row.oldestDueDate = inv.dueDate;
    }
    map.set(key, row);
  }
  return [...map.values()]
    .map(({ latestIssue: _latest, ...r }) => ({
      ...r, billed: r.billed / 100, paid: r.paid / 100, open: r.open / 100, overdue: r.overdue / 100,
    }))
    .sort((a, b) => a.apartment.localeCompare(b.apartment, 'fi', { numeric: true }));
};

/** Laskun tila maksujen jälkeen. */
export const statusAfterPayment = (total: number, paid: number, current: string): string =>
  toCents(paid) >= toCents(total) ? 'PAID' : current === 'DRAFT' ? 'SENT' : current === 'PAID' ? 'SENT' : current;
