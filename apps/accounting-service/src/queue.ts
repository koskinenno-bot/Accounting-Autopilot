/**
 * Poikkeusjono: isännöitsijän tehtävät kaikista yhtiöistä yhdessä listassa.
 * Puhdas logiikka (ei tietokantaa), jotta säännöt voidaan testata.
 */

export type QueueKind = 'CLOSING' | 'INVOICE' | 'REVIEW' | 'AUTO' | 'VOUCHER' | 'BANK';

export interface QueueItem {
  key: string;            // yksilöi tehtävän yhtiön sisällä (QueueTask.itemKey)
  companyId: string;
  kind: QueueKind;
  priority: 1 | 2 | 3;    // 1 = kiireellinen, 3 = kun ehdit
  title: string;
  detail?: string;
  date?: string;          // tehtävään liittyvä päivä (vienti, lasku)
  dueDate?: string;       // määräpäivä, jos on
  amount?: number;
  entryId?: string;
  count?: number;
}

export interface QueueInput {
  today: Date;
  drafts: { id: string; companyId: string; entryDate: Date; description: string | null; counterparty: string | null;
    autoApprovable: boolean; needsVoucher: boolean; reviewNote: string | null; amount: number }[];
  missingVouchers: { id: string; companyId: string; entryDate: Date; description: string | null; counterparty: string | null; amount: number;
    voucherRequestedAt?: Date | null; voucherRequestedFrom?: string | null }[];
  invoices: { id: string; companyId: string; supplierName: string; invoiceNumber: string | null; dueDate: Date | null; totalAmount: number; status: string }[];
  endedOpenYears: { id: string; companyId: string; startDate: Date; endDate: Date }[];
  lastBankDates: { companyId: string; lastDate: Date | null }[];
}

const DAY = 86_400_000;
export const INVOICE_LOOKAHEAD_DAYS = 7;
export const BANK_STALE_DAYS = 10;
export const VOUCHER_URGENT_DAYS = 30;
export const REVIEW_URGENT_DAYS = 30;
export const VOUCHER_REQUEST_WAIT_DAYS = 7;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY);
const fiDate = (d: Date) => `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;

/** Kirjanpitolain mukaan tilinpäätös on laadittava neljän kuukauden kuluessa tilikauden päättymisestä. */
export const closingDeadline = (endDate: Date) => {
  // päättymistä seuraava päivä + 4 kk - 1 pv (31.12. -> 30.4., 30.6. -> 31.10.)
  const d = new Date(endDate.getTime() + DAY);
  d.setUTCMonth(d.getUTCMonth() + 4);
  return new Date(d.getTime() - DAY);
};

export const buildQueue = (input: QueueInput): QueueItem[] => {
  const { today } = input;
  const items: QueueItem[] = [];

  for (const fy of input.endedOpenYears) {
    const deadline = closingDeadline(fy.endDate);
    const daysLeft = daysBetween(today, deadline);
    items.push({
      key: `closing:${fy.id}`, companyId: fy.companyId, kind: 'CLOSING',
      priority: daysLeft <= 30 ? 1 : 2,
      title: `Tilinpäätös tekemättä (tilikausi päättyi ${fiDate(fy.endDate)})`,
      detail: daysLeft < 0 ? `Lakisääteinen määräaika ylittyi ${-daysLeft} päivää sitten` : `Määräaikaa jäljellä ${daysLeft} päivää`,
      date: iso(fy.endDate), dueDate: iso(deadline),
    });
  }

  for (const inv of input.invoices) {
    if (inv.status === 'PAID' || !inv.dueDate) continue;
    const daysToDue = daysBetween(today, inv.dueDate);
    if (daysToDue > INVOICE_LOOKAHEAD_DAYS) continue;
    items.push({
      key: `invoice:${inv.id}`, companyId: inv.companyId, kind: 'INVOICE',
      priority: daysToDue < 0 ? 1 : 2,
      title: `${daysToDue < 0 ? 'Erääntynyt' : 'Erääntyy'}: ${inv.supplierName}${inv.invoiceNumber ? ` (lasku ${inv.invoiceNumber})` : ''}`,
      detail: daysToDue < 0 ? `Eräpäivä oli ${-daysToDue} päivää sitten. Maksu ei näy pankissa.` : `Eräpäivä ${daysToDue === 0 ? 'tänään' : `${daysToDue} päivän päästä`}`,
      dueDate: iso(inv.dueDate), amount: inv.totalAmount,
    });
  }

  const autoByCompany = new Map<string, { count: number; amount: number }>();
  for (const e of input.drafts) {
    if (e.autoApprovable) {
      const cur = autoByCompany.get(e.companyId) ?? { count: 0, amount: 0 };
      autoByCompany.set(e.companyId, { count: cur.count + 1, amount: cur.amount + e.amount });
      continue;
    }
    const age = daysBetween(e.entryDate, today);
    items.push({
      key: `entry:${e.id}`, companyId: e.companyId, kind: 'REVIEW',
      priority: age > REVIEW_URGENT_DAYS ? 1 : 2,
      title: `Tarkista kirjaus: ${e.counterparty || e.description || 'nimetön vienti'}`,
      detail: e.reviewNote || (e.needsVoucher ? 'Tosite puuttuu' : undefined),
      date: iso(e.entryDate), amount: e.amount, entryId: e.id,
    });
  }
  for (const [companyId, { count, amount }] of autoByCompany) {
    items.push({
      key: 'auto', companyId, kind: 'AUTO', priority: 3,
      title: `${count} varmaa kirjausta hyväksyttäväksi`,
      detail: 'Järjestelmä on varma tiliöinnistä. Hyväksy yhdellä painalluksella.',
      amount, count,
    });
  }

  for (const e of input.missingVouchers) {
    const age = daysBetween(e.entryDate, today);
    // Juuri pyydetty tosite ei ole kiireellinen: odotetaan vastausta viikko
    const requestedRecently = e.voucherRequestedAt ? daysBetween(e.voucherRequestedAt, today) < VOUCHER_REQUEST_WAIT_DAYS : false;
    items.push({
      key: `voucher:${e.id}`, companyId: e.companyId, kind: 'VOUCHER',
      priority: age > VOUCHER_URGENT_DAYS && !requestedRecently ? 2 : 3,
      title: `Tosite puuttuu: ${e.counterparty || e.description || 'pankkimeno'}`,
      detail: e.voucherRequestedAt
        ? `Maksettu ${fiDate(e.entryDate)}. Tositetta pyydetty ${fiDate(e.voucherRequestedAt)}${e.voucherRequestedFrom ? ` (${e.voucherRequestedFrom})` : ''}.`
        : `Maksettu ${fiDate(e.entryDate)}, ${age} päivää sitten. Pyydä tosite toimittajalta tai hallitukselta.`,
      date: iso(e.entryDate), amount: e.amount, entryId: e.id,
    });
  }

  for (const b of input.lastBankDates) {
    const age = b.lastDate ? daysBetween(b.lastDate, today) : null;
    if (age !== null && age <= BANK_STALE_DAYS) continue;
    items.push({
      key: 'bank', companyId: b.companyId, kind: 'BANK',
      priority: age !== null && age > 30 ? 2 : 3,
      title: age === null ? 'Ei tiliotteita' : `Tiliote ${age} päivää vanha`,
      detail: 'Tuo uusi tiliote tai tarkista pankkiyhteys.',
      date: b.lastDate ? iso(b.lastDate) : undefined,
    });
  }

  return sortQueue(items);
};

const KIND_ORDER: QueueKind[] = ['CLOSING', 'INVOICE', 'REVIEW', 'VOUCHER', 'BANK', 'AUTO'];

/** Kiireellisin ensin; saman kiireellisyyden sisällä tyypin ja päivän mukaan (vanhin ensin). */
export const sortQueue = (items: QueueItem[]) =>
  [...items].sort((a, b) =>
    a.priority - b.priority
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || (a.dueDate ?? a.date ?? '9999').localeCompare(b.dueDate ?? b.date ?? '9999'));

/** Onko tehtävä torkutettu (ei näytetä ennen muistutuspäivää). */
export const isSnoozed = (snoozedUntil: Date | null | undefined, today: Date) =>
  Boolean(snoozedUntil && snoozedUntil.getTime() > today.getTime());
