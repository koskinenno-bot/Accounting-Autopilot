/**
 * Ostolaskujen hyväksyntä ja maksaminen (puhtaat funktiot, testattavissa).
 *
 * Hyväksyntä: isännöitsijä hyväksyy laskun (assistentti ei). Jos yhtiöllä on hallituksen raja ja lasku
 * ylittää sen, tarvitaan lisäksi hallituksen jäsenen hyväksyntä. Yksikin hylkäys hylkää laskun.
 * Maksaminen: hyväksytyistä laskuista tehdään SEPA-maksuaineisto (ISO 20022 pain.001.001.03), jonka
 * isännöitsijä lataa verkkopankkiin. Sama lasku voi olla vain yhdessä voimassa olevassa maksuerässä.
 */

export type ApprovalDecision = { role: string; decision: 'APPROVE' | 'REJECT'; userId: string };

export interface ApprovalState {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  needsBoard: boolean;
  managerApproved: boolean;
  boardApproved: boolean;
  /** Kuka hyväksyntä vielä puuttuu (näytetään käyttäjälle). */
  waitingFor: string | null;
}

// Assistentti valmistelee, mutta hyväksyjä on isännöitsijä tai hallitus (sisäinen valvonta)
const MANAGER_ROLES = ['MANAGER'];

export const approvalState = (amount: number, boardLimit: number | null, decisions: ApprovalDecision[]): ApprovalState => {
  const needsBoard = boardLimit !== null && boardLimit !== undefined && amount > boardLimit;
  const managerApproved = decisions.some((d) => d.decision === 'APPROVE' && MANAGER_ROLES.includes(d.role));
  const boardApproved = decisions.some((d) => d.decision === 'APPROVE' && d.role === 'BOARD');
  if (decisions.some((d) => d.decision === 'REJECT')) {
    return { status: 'REJECTED', needsBoard, managerApproved, boardApproved, waitingFor: null };
  }
  // Ilman hallituksen rajaa riittää yksi hyväksyntä (isännöitsijä tai hallitus)
  const approved = needsBoard ? managerApproved && boardApproved : managerApproved || boardApproved;
  const waitingFor = approved ? null
    : needsBoard && !managerApproved && !boardApproved ? 'isännöitsijä ja hallitus'
      : needsBoard && !boardApproved ? 'hallitus'
        : 'isännöitsijä';
  return { status: approved ? 'APPROVED' : 'PENDING', needsBoard, managerApproved, boardApproved, waitingFor };
};

/** IBAN-tarkiste (mod 97). Välilyönnit sallitaan. */
export const normalizeIban = (iban: string | null | undefined) => (iban ?? '').replace(/\s+/g, '').toUpperCase();
export const isValidIban = (raw: string | null | undefined): boolean => {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('FI') && iban.length !== 18) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
};

export const isValidBic = (bic: string | null | undefined) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test((bic ?? '').toUpperCase());

/** Kotimainen viite (7-3-1) tai RF-viite (ISO 11649). Palauttaa normalisoidun viitteen tai null. */
export const normalizeReference = (raw: string | null | undefined): string | null => {
  const ref = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (!ref) return null;
  if (/^RF\d{2}[A-Z0-9]{1,21}$/.test(ref)) {
    const digits = (ref.slice(4) + ref.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    let rem = 0;
    for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
    return rem === 1 ? ref : null;
  }
  const n = ref.replace(/^0+/, '');
  if (!/^\d{4,20}$/.test(n)) return null;
  const body = n.slice(0, -1);
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * weights[i % 3];
  const check = (10 - (sum % 10)) % 10;
  return check === Number(n.slice(-1)) ? n : null;
};

export interface PayableInvoice {
  id: string;
  supplierName: string;
  supplierKey: string;
  invoiceNumber: string | null;
  totalAmount: number;
  dueDate: Date | null;
  referenceNumber: string | null;
  iban: string | null;
  status: string;            // PROPOSED / BOOKED / PAID
  approvalStatus: string;
  paymentBatchId: string | null;
}

/** Miksi laskua ei voi ottaa maksuun (null = voi). */
export const paymentBlocker = (inv: PayableInvoice): string | null => {
  if (inv.status === 'PAID') return 'Lasku on jo maksettu';
  if (inv.paymentBatchId) return 'Lasku on jo maksuerässä';
  if (inv.approvalStatus !== 'APPROVED') return 'Laskua ei ole hyväksytty';
  if (!(inv.totalAmount > 0)) return 'Summa puuttuu';
  if (!isValidIban(inv.iban)) return 'Saajan IBAN puuttuu tai on virheellinen';
  return null;
};

/**
 * Mahdolliset tuplalaskut: sama toimittaja ja summa sekä sama viite tai laskunumero toisella laskulla.
 * Palauttaa laskun id -> toisen laskun id.
 */
export const findDuplicates = (invoices: PayableInvoice[]): Map<string, string> => {
  const out = new Map<string, string>();
  for (let i = 0; i < invoices.length; i++) {
    for (let j = 0; j < invoices.length; j++) {
      if (i === j) continue;
      const a = invoices[i];
      const b = invoices[j];
      if (a.supplierKey !== b.supplierKey || Math.round(a.totalAmount * 100) !== Math.round(b.totalAmount * 100)) continue;
      const sameRef = a.referenceNumber && normalizeReference(a.referenceNumber) === normalizeReference(b.referenceNumber);
      const sameNumber = a.invoiceNumber && a.invoiceNumber === b.invoiceNumber;
      const sameDue = a.dueDate && b.dueDate && a.dueDate.getTime() === b.dueDate.getTime();
      if (sameRef || sameNumber || sameDue) out.set(a.id, b.id);
    }
  }
  return out;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** SEPA sallii rajoitetun merkistön; ääkköset muunnetaan, muut erikoismerkit välilyönneiksi. */
export const sepaText = (s: string, max: number) =>
  s.replace(/[äÄ]/g, (c) => (c === 'ä' ? 'a' : 'A')).replace(/[öÖ]/g, (c) => (c === 'ö' ? 'o' : 'O')).replace(/[åÅ]/g, (c) => (c === 'å' ? 'a' : 'A'))
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const amount = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export interface Pain001Input {
  messageId: string;
  createdAt: Date;
  executionDate: string;       // YYYY-MM-DD
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  payments: { endToEndId: string; amount: number; creditorName: string; creditorIban: string; reference: string | null; message: string }[];
}

/** SEPA-tilisiirtoaineisto pain.001.001.03 (Finanssiala: kotimainen viite SCOR-tyyppisenä). */
export const buildPain001 = (p: Pain001Input): string => {
  const total = p.payments.reduce((s, x) => s + Math.round(x.amount * 100), 0) / 100;
  const debtorAgent = p.debtorBic && isValidBic(p.debtorBic)
    ? `<DbtrAgt><FinInstnId><BIC>${esc(p.debtorBic.toUpperCase())}</BIC></FinInstnId></DbtrAgt>`
    : '<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>';
  const tx = p.payments.map((x) => {
    const rmt = x.reference
      ? `<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${esc(x.reference)}</Ref></CdtrRefInf></Strd></RmtInf>`
      : `<RmtInf><Ustrd>${esc(sepaText(x.message, 140))}</Ustrd></RmtInf>`;
    return [
      '<CdtTrfTxInf>',
      `<PmtId><EndToEndId>${esc(sepaText(x.endToEndId, 35))}</EndToEndId></PmtId>`,
      `<Amt><InstdAmt Ccy="EUR">${amount(x.amount)}</InstdAmt></Amt>`,
      `<Cdtr><Nm>${esc(sepaText(x.creditorName, 70))}</Nm></Cdtr>`,
      `<CdtrAcct><Id><IBAN>${normalizeIban(x.creditorIban)}</IBAN></Id></CdtrAcct>`,
      rmt,
      '</CdtTrfTxInf>',
    ].join('');
  }).join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr><MsgId>${esc(p.messageId)}</MsgId><CreDtTm>${p.createdAt.toISOString().slice(0, 19)}</CreDtTm><NbOfTxs>${p.payments.length}</NbOfTxs><CtrlSum>${amount(total)}</CtrlSum><InitgPty><Nm>${esc(sepaText(p.debtorName, 70))}</Nm></InitgPty></GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(p.messageId)}-1</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>false</BtchBookg><NbOfTxs>${p.payments.length}</NbOfTxs><CtrlSum>${amount(total)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${p.executionDate}</ReqdExctnDt>
      <Dbtr><Nm>${esc(sepaText(p.debtorName, 70))}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${normalizeIban(p.debtorIban)}</IBAN></Id></DbtrAcct>
      ${debtorAgent}
      <ChrgBr>SLEV</ChrgBr>
      ${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
};
