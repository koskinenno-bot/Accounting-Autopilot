#!/usr/bin/env node
/**
 * Demodata: As Oy Demokoti, loka- ja marraskuu 2026.
 *
 * Ajaa koko automaatioketjun oikeiden rajapintojen kautta:
 *   käyttäjä -> yhtiö (tilikartta + tilikausi Kafkan kautta) -> avaussaldot (CSV) ->
 *   käyttöomaisuus -> osakkaat -> vastikelaskutus ->
 *   LOKAKUU:   camt.053-tiliote -> pankkipohjaiset kirjaukset (kulut ilman tositteita)
 *   MARRASKUU: ostolaskut (PDF) -> tositteiden luku ja ostovelat -> CSV-tiliote (Nordea-muoto)
 *              -> maksujen täsmäytys ostolaskuihin, "tosite puuttuu" -merkinnät
 *   -> hyväksyntä -> tuloslaskelma, tase ja vastikelaskelma.
 *
 * Käyttö (palvelut käynnissä, ks. kaynnista.ps1):  npm run demo
 * Ostolasku-PDF:t luodaan tarvittaessa:  python scripts/samples/generate_invoices.py
 * Toistettava: olemassa oleva käyttäjä, yhtiö, osakkaat, laskut ja ostolaskut käytetään uudelleen,
 * ja tiliotteiden tapahtumat ohitetaan kirjanpidossa arkistointitunnuksen perusteella.
 * Ilman ANTHROPIC_API_KEYtä ostolaskut luetaan sääntöpohjaisesti (tekstipohjaiset PDF:t), jolloin
 * tuntematon toimittaja (Rakennuspalvelu Virtanen) jää selvitettäviin eriin; avaimella tekoäly tiliöi sen.
 *
 * Demotunnukset (vain paikallinen kehitysympäristö):
 *   sähköposti: demo@demokoti.fi   salasana: Demo12345
 */
const fs = require('fs');
const path = require('path');

const DEMO_USER = { email: 'demo@demokoti.fi', password: 'Demo12345', firstName: 'Demo', lastName: 'Isännöitsijä' };
const COMPANY = {
  name: 'As Oy Demokoti',
  businessId: '3456789-1',
  housingCooperativeId: 'DEMOKOTI',
  fiscalYearStart: '2026-01-01',
  fiscalYearEnd: '2026-12-31',
};
const VASTIKE_OCT = { unitPrice: 4.5, issueDate: '2026-10-01', dueDate: '2026-10-05', description: 'Hoitovastike 10/2026', label: 'Lokakuun' };
const VASTIKE_NOV = { unitPrice: 4.5, issueDate: '2026-11-01', dueDate: '2026-11-05', description: 'Hoitovastike 11/2026', label: 'Marraskuun' };
const SAMPLES = path.join(__dirname, 'samples');
const BUILDING = { name: 'Asuinrakennus (Demokuja 1)', accountNumber: '1010', acquisitionDate: '1998-06-01', acquisitionCost: 1200000, priorDepreciation: 750000, method: 'MANUAL', manualAmount: 18000 };

const URL = {
  user: process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1',
  accounting: process.env.ACCOUNTING_SERVICE_URL || 'http://localhost:3002/api/v1',
  invoicing: process.env.INVOICING_SERVICE_URL || 'http://localhost:3004/api/v1',
  bank: process.env.BANK_SERVICE_URL || 'http://localhost:3005/api/v1',
  voucher: process.env.VOUCHER_SERVICE_URL || 'http://localhost:3003/api/v1',
  reporting: process.env.REPORTING_SERVICE_URL || 'http://localhost:3006/api/v1',
};

// Fiktiiviset osakkaat; huoneistot A1–A3 ja B4–B6
const SHAREHOLDERS = [
  { firstName: 'Aino', lastName: 'Esimerkki', email: 'aino.esimerkki@example.com', apt: 'A1', squareMeters: 35, shares: '1-350' },
  { firstName: 'Eero', lastName: 'Testinen', email: 'eero.testinen@example.com', apt: 'A2', squareMeters: 52, shares: '351-870' },
  { firstName: 'Liisa', lastName: 'Malli', email: 'liisa.malli@example.com', apt: 'A3', squareMeters: 68, shares: '871-1550' },
  { firstName: 'Matti', lastName: 'Demo', email: 'matti.demo@example.com', apt: 'B4', squareMeters: 80, shares: '1551-2350' },
  { firstName: 'Sanna', lastName: 'Kokeilu', email: 'sanna.kokeilu@example.com', apt: 'B5', squareMeters: 45, shares: '2351-2800' },
  { firstName: 'Pekka', lastName: 'Harjoitus', email: 'pekka.harjoitus@example.com', apt: 'B6', squareMeters: 74, shares: '2801-3540' },
];
// Kuka maksaa miten: B5 maksaa myöhässä (ei suoritusta lokakuussa), A2 maksaa ilman viitettä
const LATE_PAYER = 'B5';
const NO_REFERENCE_PAYER = 'A2';

// Lokakuun menot pankkitililtä (saaja, viesti, summa, päivä)
const EXPENSES = [
  { name: 'Helen Oy', message: 'Kaukolämpö 09/2026', amount: 1452.36, date: '2026-10-08' },
  { name: 'HSY', message: 'Vesi ja jätevesi 09/2026', amount: 381.2, date: '2026-10-09' },
  { name: 'HSY Jätehuolto', message: 'Jätehuolto 09/2026', amount: 118.9, date: '2026-10-12' },
  { name: 'Fortum Markets Oy', message: 'Sähkö yhteiset tilat 09/2026', amount: 209.75, date: '2026-10-14' },
  { name: 'Isännöinti Oy Esimerkki', message: 'Isännöintipalkkio 10/2026', amount: 650.0, date: '2026-10-15' },
  { name: 'If Vahinkovakuutus Oyj', message: 'Kiinteistövakuutus 2026 erä 2', amount: 890.0, date: '2026-10-20' },
  { name: 'Kiinteistöhuolto Oy Esimerkki', message: 'Huolto 10/2026', amount: 520.0, date: '2026-10-22' },
  { name: 'Demopankki Oyj', message: 'Pankin palvelumaksu 10/2026', amount: 12.5, date: '2026-10-31' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eur = (n) => Number(n).toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const log = (msg) => console.log(`\n=== ${msg} ===`);

let token;
async function api(base, pathname, { method = 'GET', body, form, allow = [] } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(base + pathname, { method, headers, body: payload });
  } catch (err) {
    throw new Error(`${method} ${base}${pathname}: palvelu ei vastaa (${err.cause?.code || err.message}). Onko kaynnista.ps1 ajettu?`);
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok && !allow.includes(res.status)) {
    throw new Error(`${method} ${pathname} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

async function login() {
  log('1. Demokäyttäjä');
  const reg = await api(URL.user, '/auth/register', { method: 'POST', body: DEMO_USER, allow: [409] });
  if (reg.status === 201) {
    token = reg.data.token;
    console.log(`Rekisteröitiin ${DEMO_USER.email}`);
  } else {
    const res = await api(URL.user, '/auth/login', { method: 'POST', body: { email: DEMO_USER.email, password: DEMO_USER.password } });
    token = res.data.token;
    if (!token) throw new Error(`Kirjautuminen ei palauttanut tunnistetta: ${JSON.stringify(res.data)}`);
    console.log(`Kirjauduttiin olemassa olevalla käyttäjällä ${DEMO_USER.email}`);
  }
}

async function ensureCompany() {
  log('2. Yhtiö, tilikartta ja tilikausi');
  const { data: companies } = await api(URL.user, '/companies');
  let company = companies.find((c) => c.businessId === COMPANY.businessId);
  if (company) {
    console.log(`${company.name} on jo olemassa (${company.id})`);
  } else {
    ({ data: company } = await api(URL.user, '/companies', { method: 'POST', body: COMPANY }));
    console.log(`Luotiin ${company.name} (${company.id})`);
  }

  // Tilikartta ja tilikausi syntyvät accounting-serviceen Kafkan company.created-tapahtumasta
  for (let i = 0; i < 30; i++) {
    const { data: accounts } = await api(URL.accounting, `/accounting/accounts?companyId=${company.id}`);
    const { data: years } = await api(URL.accounting, `/accounting/fiscal-years?companyId=${company.id}`);
    if (accounts.length > 0 && years.length > 0) {
      console.log(`Tilikartassa ${accounts.length} tiliä, tilikausia ${years.length} (${years.map((y) => `${y.startDate.slice(0, 10)}–${y.endDate.slice(0, 10)} ${y.status}`).join(', ')})`);
      return company;
    }
    await sleep(1000);
  }
  throw new Error('Tilikarttaa/tilikautta ei syntynyt 30 sekunnissa. Tarkista accounting-servicen ja Kafkan ikkunat.');
}

/** "tili;nimi;saldo" -> rivit (sama muoto kuin dashboardin Tilinpäätös-sivun tuonnissa). */
const parseOpeningCsv = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).flatMap((line) => {
  const [accountNumber, name, balance] = line.split(';').map((s) => s.trim());
  return /^\d{4}$/.test(accountNumber) ? [{ accountNumber, name, balance: Number(balance.replace(/\s/g, '').replace(',', '.')) }] : [];
});

// Avaava tase edellisen tilikauden tilinpäätöksestä (scripts/samples/avaustase-2026.csv)
async function ensureOpeningBalance(companyId) {
  const { data: years } = await api(URL.accounting, `/accounting/fiscal-years?companyId=${companyId}`);
  const fy = years.find((y) => y.startDate.startsWith('2026-01-01'));
  const rows = parseOpeningCsv(fs.readFileSync(path.join(SAMPLES, 'avaustase-2026.csv'), 'utf8'));
  const { status, data } = await api(URL.accounting, `/accounting/fiscal-years/${fy.id}/opening-balances`, {
    method: 'POST', body: { rows }, allow: [409],
  });
  if (status === 201) return console.log(`Kirjattiin avaustase (${rows.length} tiliä) tositteella ${data.voucherNumber}`);
  console.log('Avaustase on jo kirjattu');

  // Demon ensimmäinen versio kirjasi avaukseen vain pankkitilin. Puuttuvat tasetilit (rakennus,
  // osakepääoma, laina) lisätään erillisellä täydennysviennillä; kirjattua vientiä ei muuteta (KPL 2:7 §).
  const { data: ledger } = await api(URL.accounting, `/accounting/ledger?companyId=${companyId}`);
  const opening = ledger.find((e) => e.voucherNumber === 'AVAUS-2026');
  const missing = rows.filter((r) => !['1900', '2100'].includes(r.accountNumber));
  if (opening && !opening.lines.some((l) => l.accountNumber === '1010')) {
    const { status: s } = await api(URL.accounting, '/accounting/entries', {
      method: 'POST', allow: [409],
      body: {
        companyId, entryDate: '2026-01-01', voucherNumber: 'AVAUS-2026-T', description: 'Avaustaseen täydennys: rakennus, osakepääoma ja laina',
        lines: missing.map((r) => (r.accountNumber < '2000'
          ? { accountNumber: r.accountNumber, debit: r.balance, credit: 0, description: r.name }
          : { accountNumber: r.accountNumber, debit: 0, credit: r.balance, description: r.name })),
      },
    });
    if (s === 201) console.log('Täydennettiin vanhaa demoavausta: rakennus, osakepääoma ja laina');
  }
}

async function ensureAsset(companyId) {
  const { data: assets } = await api(URL.accounting, `/accounting/assets?companyId=${companyId}`);
  if (assets.some((a) => a.name === BUILDING.name)) return console.log('Rakennus on jo käyttöomaisuusrekisterissä');
  await api(URL.accounting, '/accounting/assets', { method: 'POST', body: { companyId, ...BUILDING } });
  console.log(`Käyttöomaisuus: ${BUILDING.name}, vuosipoisto ${eur(BUILDING.manualAmount)} (lainanlyhennysten mukaan, kirjataan tilinpäätöksessä)`);
}

async function ensureShareholders(companyId) {
  log('3. Osakkaat');
  const { data: existing } = await api(URL.user, `/shareholders?companyId=${companyId}`);
  const byEmail = new Map(existing.map((s) => [s.email, s]));
  for (const sh of SHAREHOLDERS) {
    if (byEmail.has(sh.email)) continue;
    await api(URL.user, '/shareholders', {
      method: 'POST',
      body: {
        companyId,
        personType: 'individual',
        firstName: sh.firstName,
        lastName: sh.lastName,
        email: sh.email,
        shares: [{
          shareNumbers: [sh.shares],
          apartment: { number: sh.apt, squareMeters: sh.squareMeters },
          ownershipStart: '2020-01-01',
        }],
      },
    });
    console.log(`Lisättiin ${sh.firstName} ${sh.lastName}, huoneisto ${sh.apt} (${sh.squareMeters} m²)`);
  }
  const { data: all } = await api(URL.user, `/shareholders?companyId=${companyId}`);
  console.log(`Osakkaita yhteensä ${all.length}`);
}

async function ensureInvoices(companyId, vastike) {
  log(`${vastike.label} hoitovastikkeet (massalaskutus)`);
  const isMonth = (inv) => inv.dueDate.slice(0, 10) === vastike.dueDate;
  let { data: invoices } = await api(URL.invoicing, `/invoices?companyId=${companyId}`);
  if (invoices.some(isMonth)) {
    console.log(`${vastike.label} vastikelaskut on jo luotu, ei laskuteta uudelleen`);
  } else {
    const { label, ...body } = vastike;
    const { data } = await api(URL.invoicing, '/invoices/bulk-maintenance-fees', {
      method: 'POST',
      body: { companyId, ...body },
    });
    console.log(data.message);
    if (!(data.count > 0)) throw new Error('Laskuja ei syntynyt: tarkista osakkaiden squareMeters');
    ({ data: invoices } = await api(URL.invoicing, `/invoices?companyId=${companyId}`));
  }
  const october = invoices.filter(isMonth);
  const emailToApt = new Map(SHAREHOLDERS.map((s) => [s.email, s.apt]));
  for (const inv of october) inv.apt = emailToApt.get(inv.recipientEmail);
  october.sort((a, b) => String(a.apt).localeCompare(String(b.apt)));
  for (const inv of october) {
    console.log(`  ${inv.apt}  ${inv.recipientName.padEnd(18)} ${eur(inv.totalAmount).padStart(10)}  viite ${inv.referenceNumber}  ${inv.status}`);
  }
  return october;
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildCamt053(invoices) {
  const entries = [];
  let seq = 1;
  const ntryRef = () => `DEMO-2026-10-${String(seq++).padStart(3, '0')}`;

  for (const inv of invoices) {
    if (inv.apt === LATE_PAYER) continue;
    const withRef = inv.apt !== NO_REFERENCE_PAYER;
    const rmtInf = withRef
      ? `<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${xmlEscape(inv.referenceNumber)}</Ref></CdtrRefInf></Strd></RmtInf>`
      : `<RmtInf><Ustrd>Vastike lokakuu ${xmlEscape(inv.apt)}</Ustrd></RmtInf>`;
    entries.push({
      date: inv.apt === 'A1' ? '2026-10-03' : '2026-10-05',
      amount: Number(inv.totalAmount),
      cd: 'CRDT',
      party: `<Dbtr><Nm>${xmlEscape(inv.recipientName)}</Nm></Dbtr>`,
      rmtInf,
    });
  }
  for (const e of EXPENSES) {
    entries.push({
      date: e.date,
      amount: e.amount,
      cd: 'DBIT',
      party: `<Cdtr><Nm>${xmlEscape(e.name)}</Nm></Cdtr>`,
      rmtInf: `<RmtInf><Ustrd>${xmlEscape(e.message)}</Ustrd></RmtInf>`,
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  const ntryXml = entries.map((e) => `
      <Ntry>
        <NtryRef>${ntryRef()}</NtryRef>
        <Amt Ccy="EUR">${e.amount.toFixed(2)}</Amt>
        <CdtDbtInd>${e.cd}</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>${e.date}</Dt></BookgDt>
        <ValDt><Dt>${e.date}</Dt></ValDt>
        <NtryDtls>
          <TxDtls>
            <RltdPties>${e.party}</RltdPties>
            ${e.rmtInf}
          </TxDtls>
        </NtryDtls>
      </Ntry>`).join('');

  const sum = (cd) => entries.filter((e) => e.cd === cd).reduce((s, e) => s + e.amount, 0);
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>DEMOKOTI-2026-10</MsgId>
      <CreDtTm>2026-11-01T08:00:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>DEMOKOTI-STMT-2026-10</Id>
      <CreDtTm>2026-11-01T08:00:00</CreDtTm>
      <FrToDt><FrDtTm>2026-10-01T00:00:00</FrDtTm><ToDtTm>2026-10-31T23:59:59</ToDtTm></FrToDt>
      <Acct><Id><IBAN>FI2112345600000785</IBAN></Id><Ccy>EUR</Ccy><Ownr><Nm>${xmlEscape(COMPANY.name)}</Nm></Ownr></Acct>
      <TxsSummry>
        <TtlCdtNtries><NbOfNtries>${entries.filter((e) => e.cd === 'CRDT').length}</NbOfNtries><Sum>${sum('CRDT').toFixed(2)}</Sum></TtlCdtNtries>
        <TtlDbtNtries><NbOfNtries>${entries.filter((e) => e.cd === 'DBIT').length}</NbOfNtries><Sum>${sum('DBIT').toFixed(2)}</Sum></TtlDbtNtries>
      </TxsSummry>${ntryXml}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`,
    count: entries.length,
    incoming: sum('CRDT'),
    outgoing: sum('DBIT'),
  };
}

async function uploadStatement(companyId, invoices) {
  log('Lokakuu: camt.053-tiliote (pankkipohjainen kirjanpito)');
  const statement = buildCamt053(invoices);
  const file = path.join(__dirname, 'demo-tiliote-2026-10.xml');
  fs.writeFileSync(file, statement.xml, 'utf8');
  console.log(`Kirjoitettiin ${path.relative(process.cwd(), file)}: ${statement.count} tapahtumaa, saapuvat ${eur(statement.incoming)}, lähtevät ${eur(statement.outgoing)}`);

  const form = new FormData();
  form.append('companyId', companyId);
  form.append('file', new Blob([statement.xml], { type: 'application/xml' }), path.basename(file));
  const { data } = await api(URL.bank, '/bank/upload-statement', { method: 'POST', form });
  console.log(`bank-service: ${data.transactionCount} tapahtumaa, viitteellisiä suorituksia ${data.results?.matchedInvoices}`);

  // Kirjaukset syntyvät asynkronisesti Kafkan kautta; odotetaan kunnes pankkivientejä ei enää tule lisää
  let previous = -1;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const { data: ledger } = await api(URL.accounting, `/accounting/ledger?companyId=${companyId}`);
    const bank = ledger.filter((e) => e.voucherNumber.startsWith('BANK-DEMO-2026-10')).length;
    if (bank >= statement.count || (bank > 0 && bank === previous)) break;
    previous = bank;
  }
}

/** Marraskuu: ostolaskut ensin (tositteet), sitten tiliote. */
async function uploadPurchaseInvoices(companyId) {
  log('Marraskuu: ostolaskut (PDF) -> tositteiden luku -> ostovelat');
  const metaFile = path.join(SAMPLES, 'ostolaskut.json');
  if (!fs.existsSync(metaFile)) {
    throw new Error('Ostolasku-PDF:t puuttuvat. Aja ensin: python scripts/samples/generate_invoices.py');
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const { data: existing } = await api(URL.accounting, `/accounting/purchase-invoices?companyId=${companyId}`);
  const known = new Set(existing.map((p) => p.invoiceNumber));
  const { data: vouchers } = await api(URL.voucher, `/vouchers?companyId=${companyId}`);
  const uploadedFiles = new Set(vouchers.flatMap((v) => (v.files || []).map((f) => f.filename)));

  let uploaded = 0;
  for (const inv of meta) {
    if (known.has(inv.number) || uploadedFiles.has(inv.file)) continue;
    const form = new FormData();
    form.append('companyId', companyId);
    form.append('voucherType', 'PURCHASE');
    form.append('file', new Blob([fs.readFileSync(path.join(SAMPLES, 'ostolaskut', inv.file))], { type: 'application/pdf' }), inv.file);
    await api(URL.voucher, '/vouchers/upload', { method: 'POST', form });
    uploaded++;
  }
  console.log(uploaded ? `Ladattiin ${uploaded} ostolaskua, luetaan…` : 'Ostolaskut on jo ladattu');

  // Luku tapahtuu taustalla (tekoäly voi kestää); odotetaan valmistumista ja kirjauksia
  for (let i = 0; i < 120; i++) {
    const { data: list } = await api(URL.voucher, `/vouchers?companyId=${companyId}`);
    if (!list.some((v) => ['PENDING', 'PROCESSING'].includes(v.ocrStatus))) break;
    await sleep(2000);
  }
  await sleep(3000);
  const { data: invoices } = await api(URL.accounting, `/accounting/purchase-invoices?companyId=${companyId}`);
  for (const p of invoices) {
    console.log(`  ${p.invoiceDate.slice(0, 10)} ${p.supplierName.padEnd(30)} ${String(p.invoiceNumber).padEnd(14)} ${eur(p.totalAmount).padStart(11)}  tili ${p.expenseAccount}  ${p.status}  (${p.extractor}, varmuus ${Math.round(p.confidence * 100)} %)`);
  }
  return meta;
}

/** Marraskuun tiliote Nordean CSV-muodossa: vastikesuoritukset, ostolaskujen maksut ja tositteettomat menot. */
function buildNovemberCsv(vastikeInvoices, purchases) {
  const rows = [];
  for (const inv of vastikeInvoices) {
    if (inv.apt === LATE_PAYER) continue;
    rows.push({ date: inv.apt === 'A1' ? '2026-11-03' : '2026-11-05', amount: Number(inv.totalAmount), name: inv.recipientName, title: 'Viitesiirto', ref: inv.referenceNumber });
  }
  for (const p of purchases) {
    if (!p.paid) continue; // ei vielä maksettu => jää ostovelaksi
    const ref = p.paid === 'ref' ? p.ref.replace(/\s/g, '') : '';
    // 'amount': maksun saajan nimi poikkeaa laskusta => täsmäytys pelkän summan perusteella
    const name = p.paid === 'amount' ? 'Sähkö Kauppa Oy' : p.supplier;
    rows.push({ date: p.payDate, amount: -p.amount, name, title: `Lasku ${p.number}`, ref });
  }
  rows.push({ date: '2026-11-21', amount: -86, name: 'Lukkoliike Avain Oy', title: 'Avaimet B-rappu', ref: '' }); // ei tositetta
  rows.push({ date: '2026-11-30', amount: -12.5, name: 'Demopankki Oyj', title: 'Palvelumaksu 11/2026', ref: '' });
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const fmt = (n) => n.toFixed(2).replace('.', ',');
  const lines = ['Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta;Arkistointitunnus'];
  rows.forEach((r, i) => {
    const incoming = r.amount > 0;
    lines.push([r.date.replace(/-/g, '/'), fmt(r.amount), incoming ? r.name : COMPANY.name, incoming ? COMPANY.name : r.name,
      r.name, r.title, r.ref, 'EUR', `DEMO-2026-11-${String(i + 1).padStart(3, '0')}`].join(';'));
  });
  return { csv: lines.join('\n') + '\n', count: rows.length };
}

async function uploadNovemberStatement(companyId, vastikeInvoices, purchases) {
  log('Marraskuu: CSV-tiliote (Nordea) -> maksujen täsmäytys ostolaskuihin');
  const { csv, count } = buildNovemberCsv(vastikeInvoices, purchases);
  const file = path.join(__dirname, 'demo-tiliote-2026-11.csv');
  fs.writeFileSync(file, csv, 'utf8');
  const form = new FormData();
  form.append('companyId', companyId);
  form.append('file', new Blob([csv], { type: 'text/csv' }), path.basename(file));
  const { data } = await api(URL.bank, '/bank/upload-statement', { method: 'POST', form });
  console.log(`Kirjoitettiin ${path.relative(process.cwd(), file)}; bank-service: ${data.transactionCount} tapahtumaa (${data.format})`);
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const { data: ledger } = await api(URL.accounting, `/accounting/ledger?companyId=${companyId}`);
    if (ledger.filter((e) => e.voucherNumber.startsWith('BANK-DEMO-2026-11')).length >= count) break;
  }
}

async function summarizeAndPost(companyId, invoiceIds) {
  log('Automaattiset kirjaukset ja hyväksyntä');
  const { data: accounts } = await api(URL.accounting, `/accounting/accounts?companyId=${companyId}`);
  const names = new Map(accounts.map((a) => [a.accountNumber, a.accountName]));
  const { data: ledger } = await api(URL.accounting, `/accounting/ledger?companyId=${companyId}`);
  const sorted = [...ledger].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.voucherNumber.localeCompare(b.voucherNumber));

  const accountsOf = (e) => e.lines.map((l) => l.accountNumber);
  const isSuspense = (e) => accountsOf(e).includes('1990');
  for (const e of sorted) {
    const debit = e.lines.find((l) => Number(l.debit) > 0);
    const credit = e.lines.find((l) => Number(l.credit) > 0);
    console.log(`  ${e.entryDate.slice(0, 10)} ${e.status.padEnd(6)} ${e.createdBy.padEnd(17)} D ${debit.accountNumber} ${String(names.get(debit.accountNumber) || '').padEnd(26)} K ${credit.accountNumber} ${String(names.get(credit.accountNumber) || '').padEnd(26)} ${eur(debit.debit).padStart(10)}  ${e.description}`);
  }

  // Hyväksytään luonnokset, joita ei ohjattu selvitettäviin eriin. Tositteettomista hyväksytään vain
  // pankkikulut (tiliote riittää tositteeksi); muut jäävät Käsittelemättömiin näytettäviksi.
  const isBankFee = (e) => accountsOf(e).includes('4900');
  let posted = 0;
  const left = [];
  for (const e of sorted.filter((x) => x.status === 'DRAFT')) {
    if (isSuspense(e) || (e.needsVoucher && !e.voucherId && !isBankFee(e))) { left.push(e); continue; }
    await api(URL.accounting, `/accounting/entries/${e.id}/post`, { method: 'POST', body: { acknowledgeMissingVoucher: isBankFee(e) } });
    posted++;
  }
  console.log(`\nVientejä ${sorted.length}, joista automaattisia ${sorted.filter((e) => e.createdBy.startsWith('system')).length}.`);
  console.log(`Hyväksyttiin nyt ${posted} luonnosta. Käsiteltäväksi jäi ${left.length}:`);
  for (const e of left) console.log(`  - ${e.description}${e.reviewNote ? ` (${e.reviewNote})` : ''}`);

  const { data: invoices } = await api(URL.invoicing, `/invoices?companyId=${companyId}`);
  const mine = invoices.filter((i) => invoiceIds.has(i.id));
  console.log(`Laskut: ${mine.filter((i) => i.status === 'PAID').length} maksettu, ${mine.filter((i) => i.status !== 'PAID').length} avoinna (${mine.filter((i) => i.status !== 'PAID').map((i) => `${i.recipientName} ${eur(i.totalAmount)}`).join(', ')})`);
}

function printRows(rows, indent = '  ') {
  for (const row of rows || []) {
    const label = row.name || row.accountName || row.label || row.accountNumber || '';
    const amount = row.amount ?? row.balance ?? row.total;
    console.log(`${indent}${String(row.accountNumber || '').padEnd(5)} ${String(label).padEnd(32)} ${amount !== undefined ? eur(amount).padStart(12) : ''}`);
  }
}

const printSections = (sections) => {
  for (const s of sections) {
    if (s.subtotal) { console.log(`  ${s.title.toUpperCase().padEnd(48)} ${eur(s.total).padStart(13)}`); continue; }
    for (const r of s.rows || []) console.log(`    ${r.label.padEnd(46)} ${eur(r.amount).padStart(13)}`);
    console.log(`  ${(s.title + ' yhteensä').padEnd(48)} ${eur(s.total).padStart(13)}`);
  }
};

async function reports(companyId) {
  log('Raportit (vain hyväksytyt viennit, avoin tilikausi)');
  const { data: income } = await api(URL.reporting, `/reports/income-statement?companyId=${companyId}`);
  const { data: balance } = await api(URL.reporting, `/reports/balance-sheet?companyId=${companyId}`);
  const { data: vastike } = await api(URL.reporting, `/reports/maintenance-calculation?companyId=${companyId}`);

  console.log(`\nTuloslaskelma ${income.fiscalYear?.startDate?.slice(0, 10)}–${income.fiscalYear?.endDate?.slice(0, 10)}:`);
  printSections(income.sections);
  console.log('\nTase, vastaavaa:');
  printSections(balance.sections.assets);
  console.log(`  ${'VASTAAVAA YHTEENSÄ'.padEnd(48)} ${eur(balance.assets.total).padStart(13)}`);
  console.log('Tase, vastattavaa:');
  printSections(balance.sections.liabilities);
  console.log(`  ${'VASTATTAVAA YHTEENSÄ'.padEnd(48)} ${eur(balance.equity.total).padStart(13)}   (täsmää: ${balance.balanced})`);
  const m = vastike.maintenance_fund;
  const c = vastike.capital_fund;
  console.log(`\nVastikelaskelma: hoitorahoitus ${eur(m.income)} - ${eur(m.expenses)} = ${eur(m.surplus)}; pääomarahoitus ${eur(c.income)} - ${eur(c.expenses)} = ${eur(c.surplus)}`);

  if (balance && balance.balanced === false) {
    console.log('\nVAROITUS: tase ei täsmää (balanced=false)');
    process.exitCode = 1;
  }
}

(async () => {
  await login();
  const company = await ensureCompany();
  await ensureOpeningBalance(company.id);
  await ensureAsset(company.id);
  await ensureShareholders(company.id);
  // Lokakuu: pankkipohjainen
  const october = await ensureInvoices(company.id, VASTIKE_OCT);
  await uploadStatement(company.id, october);
  // Marraskuu: tositteet ensin, sitten pankki
  const november = await ensureInvoices(company.id, VASTIKE_NOV);
  const purchases = await uploadPurchaseInvoices(company.id);
  await uploadNovemberStatement(company.id, november, purchases);
  await summarizeAndPost(company.id, new Set([...october, ...november].map((i) => i.id)));
  await reports(company.id);
  console.log(`\nValmis. Kirjaudu dashboardiin http://localhost:5173 tunnuksella ${DEMO_USER.email} (salasana tämän tiedoston alussa).`);
})().catch((err) => {
  console.error(`\nDEMO EPÄONNISTUI: ${err.message}`);
  process.exit(1);
});
