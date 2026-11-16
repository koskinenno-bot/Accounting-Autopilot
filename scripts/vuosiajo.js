#!/usr/bin/env node
/**
 * Vuosiajo: koko tilivuosi esimerkkiyhtiöllä alusta loppuun oikeita rajapintoja vasten.
 *
 *   KAYNNISTA-KEVYT.bat (palvelin http://localhost:3000), sitten:  npm run vuosiajo
 *
 * Jokainen ajo luo uuden käyttäjän ja yhtiön (As Oy Vuosikoe <aika>), joten ajon voi toistaa.
 * Tilivuosi on 2025 ja vertailuvuosi 2024 tulee saldoluettelosta (scripts/samples/saldoluettelo-2024.csv).
 *
 *  1. Rekisteröinti, yhtiö, hallituksen jäsenen kutsu (hyväksyy isot laskut)
 *  2. Siirto vanhasta: saldoluettelo -> vertailukausi 2024 ja avaustase 1.1.2025
 *  3. Osakasluettelo, vastikeperusteet, ALV (liiketila), käyttöomaisuus, talousarvio
 *  4. Joka kuukausi: vastikelaskutus, liiketilan vuokralasku, ostolaskut (PDF) -> luku -> hyväksyntä ->
 *     maksuaineisto -> tiliote (camt.053) -> täsmäytys -> käsittelemättömät -> pankkitäsmäytys
 *  5. Neljännesvuosittain: arvonlisäveroilmoitus ja tilitys
 *  6. Tilinpäätös: poistot, jaksotukset, tarkistuslista, sulkeminen, toimintakertomus, allekirjoitus,
 *     PDF:t, veroilmoitus 4
 *  7. Tarkistus: raporttien luvut verrataan ajon omiin laskelmiin
 *
 * Ei vaadi pankkiyhteyttä, Verohallinnon rajapintaa eikä tekoälyavainta (tiliotteet tiedostoina,
 * ostolaskut tekstipohjaisina PDF:inä, jotka luetaan sääntöpohjaisesti).
 * Tulos: konsoliin ja kansioon scratch/vuosiajo-<aika>/ (PDF:t, maksuaineistot, tiliotteet, yhteenveto.json).
 * Poistumiskoodi 1, jos jokin tarkistus epäonnistui.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = (process.env.API_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');
const YEAR = 2025;
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const OUT = path.join(__dirname, '..', 'scratch', `vuosiajo-${STAMP}`);
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Apufunktiot
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eur = (n) => Number(n).toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fiAmount = (n) => Number(n).toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ');
const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const fiDate = (s) => { const [y, m, d] = s.split('-'); return `${Number(d)}.${Number(m)}.${y}`; };
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const log = (msg) => console.log(`\n=== ${msg} ===`);

const findings = [];
/** Havainto: 'VIRHE' kaataa ajon lopussa, 'HUOM' on tiedoksi. */
const note = (level, msg) => { findings.push({ level, msg }); console.log(`  [${level}] ${msg}`); };
const checks = [];
const check = (label, actual, expected, tol = 0.005) => {
  const ok = Math.abs(Number(actual) - Number(expected)) <= tol;
  checks.push({ label, actual: Number(actual), expected: Number(expected), ok });
  console.log(`  ${ok ? 'OK ' : 'ERO'} ${label}: ${eur(actual)}${ok ? '' : ` (odotettu ${eur(expected)})`}`);
  return ok;
};

let token;
async function api(pathname, { method = 'GET', body, form, allow = [], raw = false, as } = {}) {
  const auth = as ?? token;
  const headers = auth ? { Authorization: `Bearer ${auth}` } : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(BASE + pathname, { method, headers, body: payload });
  } catch (err) {
    throw new Error(`${method} ${pathname}: palvelin ei vastaa (${err.cause?.code || err.message}). Onko KAYNNISTA-KEVYT.bat käynnissä?`);
  }
  if (raw && res.ok) return { status: res.status, data: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok && !allow.includes(res.status)) {
    throw new Error(`${method} ${pathname} -> ${res.status}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

/** Y-tunnuksen tarkiste (painot 7,9,10,5,8,4,2). */
const businessIdFrom = (seven) => {
  const w = [7, 9, 10, 5, 8, 4, 2];
  const s = seven.split('').reduce((t, c, i) => t + Number(c) * w[i], 0) % 11;
  if (s === 1) return null;
  return `${seven}-${s === 0 ? 0 : 11 - s}`;
};
const randomBusinessId = () => {
  for (;;) {
    const id = businessIdFrom(String(Math.floor(1_000_000 + Math.random() * 8_999_999)));
    if (id) return id;
  }
};
/** Kotimainen viitenumero 7-3-1. */
const reference = (base) => {
  const digits = String(base).replace(/\D/g, '');
  const w = [7, 3, 1];
  const sum = digits.split('').reverse().reduce((t, c, i) => t + Number(c) * w[i % 3], 0);
  return digits + ((10 - (sum % 10)) % 10);
};
const mod97 = (s) => s.split('').reduce((r, c) => (r * 10 + Number(c)) % 97, 0);
/** Suomalainen IBAN tilinumeron 14 numerosta (tarkiste laskettu). */
const ibanFrom = (bban) => {
  const check = 98 - mod97(`${bban}151800`);
  return `FI${pad(check)}${bban}`;
};
const groupIban = (iban) => iban.replace(/(.{4})/g, '$1 ').trim();

// ---------------------------------------------------------------------------
// Esimerkkiyhtiö
// ---------------------------------------------------------------------------
const COMPANY_NAME = `As Oy Vuosikoe ${STAMP.slice(8, 12)}`;
const COMPANY_IBAN = ibanFrom('12345600778899');
const USER = { email: `vuosiajo-${STAMP}@example.com`, password: 'Vuosiajo2025!', firstName: 'Iida', lastName: 'Isännöitsijä' };
const BOARD_USER = { email: `hallitus-${STAMP}@example.com`, password: 'Hallitus2025!', firstName: 'Pekka', lastName: 'Puheenjohtaja' };

// Huoneistot: 1 600 m², osakkeita 16 000 (10 / m²)
const APARTMENTS = [
  ['A 1', 48, 2, 0, 'Aino Esimerkki'], ['A 2', 75, 3, 1, 'Eero Testinen'], ['A 3', 62, 1, 0, 'Liisa Malli'],
  ['A 4', 95, 4, 1, 'Matti Demo'], ['A 5', 48, 1, 0, 'Sanna Kokeilu'], ['A 6', 132, 4, 1, 'Pekka Harjoitus'],
  ['B 7', 120, 3, 1, 'Kalle Koe'], ['B 8', 210, 5, 2, 'Kiinteistö Malli Oy'], ['B 9', 160, 3, 1, 'Tiina Tarkastaja'],
  ['B 10', 250, 4, 2, 'Olli Omistaja'], ['B 11', 200, 3, 1, 'Ville Vuokranantaja'], ['B 12', 200, 4, 1, 'Helmi Hallitus'],
];
let shareNo = 1;
const APTS = APARTMENTS.map(([apt, sqm, persons, parking, owner]) => {
  const shares = sqm * 10;
  const row = { apt, sqm, persons, parking, owner, shares, range: `${shareNo}-${shareNo + shares - 1}` };
  shareNo += shares;
  return row;
});
const TOTAL_SQM = APTS.reduce((s, a) => s + a.sqm, 0);
const TOTAL_SHARES = APTS.reduce((s, a) => s + a.shares, 0);
const PRICES = { hoito: 5.0, rahoitus: 0.3, vesi: 18, autopaikka: 25 }; // €/m², €/osake, €/hlö, €/paikka kuukaudessa
const LOAN = { principal: 702000, monthlyAmortization: 3500, rate: 0.0325 };
// Maksukäyttäytyminen: A 3 maksaa tammikuun vastikkeen helmikuussa, B 9 maksaa maaliskuun ilman viitettä
const LATE = { apt: 'A 3', month: 1 };
const NO_REF = { apt: 'B 9', month: 3 };

// Liiketila (kahvila): vuokra arvonlisäverollinen, yhtiö hakeutunut verovelvolliseksi 1.1.2025
const SHOP = { tenant: 'Kahvila Kulma Oy', email: 'kahvila@example.com', rentNet: 1400, vatRate: 25.5, account: '3550' };
const VAT_DEDUCTION_PCT = 12; // liiketilan osuus kiinteistöstä (yhteiset kulut)

// Toimittajat (keksittyjä). vat = ALV-%, account = oikea kulutili (tarkistusta varten)
const SUPPLIERS = {
  lampo: { name: 'Kaukolämpö Esimerkki Oy', bid: '1234567-1', iban: ibanFrom('11223300445566'), account: '4500', vat: 25.5, text: 'Kaukolämpö' },
  vesi: { name: 'Esimerkin Vesi Oy', bid: '2345678-2', iban: ibanFrom('22334400556677'), account: '4600', vat: 25.5, text: 'Vesi- ja jätevesimaksu' },
  sahko: { name: 'Sähkö Demo Oy', bid: '3456780-3', iban: ibanFrom('33445500667788'), account: '4700', vat: 25.5, text: 'Sähkö yhteiset tilat' },
  isannointi: { name: 'Isännöintitoimisto Malli Oy', bid: '4567891-4', iban: ibanFrom('44556600778899'), account: '4000', vat: 25.5, text: 'Isännöintipalkkio' },
  huolto: { name: 'Kiinteistöhuolto Testi Oy', bid: '5678902-5', iban: ibanFrom('55667700889900'), account: '4100', vat: 25.5, text: 'Kiinteistöhuolto' },
  siivous: { name: 'Siivouspalvelu Puhdas Oy', bid: '6789013-6', iban: ibanFrom('66778800990011'), account: '4250', vat: 25.5, text: 'Porrassiivous' },
  jate: { name: 'Jätehuolto Kierto Oy', bid: '7890124-7', iban: ibanFrom('77889900112233'), account: '4300', vat: 25.5, text: 'Jätehuolto' },
  vakuutus: { name: 'Vakuutusyhtiö Turva', bid: '8901235-8', iban: ibanFrom('88990011223344'), account: '4800', vat: 0, text: 'Kiinteistövakuutus' },
  lumi: { name: 'Lumityöt Pakkanen Tmi', bid: '9012346-9', iban: ibanFrom('99001122334455'), account: '4210', vat: 25.5, text: 'Lumityöt ja hiekoitus' },
  korjaus: { name: 'Rakennusliike Vahva Oy', bid: '1029384-1', iban: ibanFrom('10293800475600'), account: '7000', vat: 25.5, text: 'Julkisivun korjaus (B-talo)' },
  tilintarkastus: { name: 'Tilintarkastus Tarkka Oy', bid: '2038475-1', iban: ibanFrom('20384700561100'), account: '4030', vat: 25.5, text: 'Toiminnantarkastus 2024' },
};
// Kuukauden ostolaskut: [toimittaja, veroton summa, laskutuskausi?]
const monthlyPurchases = (m) => {
  const heat = [0, 4200, 3900, 3300, 2400, 1300, 700, 600, 650, 1200, 2300, 3200, 4000][m];
  const list = [
    ['lampo', heat, true], ['vesi', 980, true], ['sahko', 310, true], ['isannointi', 900, true],
    ['huolto', 640, true], ['siivous', 420, true], ['jate', 260, true],
  ];
  if ([1, 4, 7, 10].includes(m)) list.push(['vakuutus', 1450, false]);
  if ([1, 2, 3, 12].includes(m)) list.push(['lumi', m === 12 ? 380 : 750, false]);
  if (m === 6) list.push(['korjaus', 12800, false]); // yli hallituksen rajan
  if (m === 4) list.push(['tilintarkastus', 600, false]);
  return list;
};
// Joulukuun lämpölasku tulee vasta tammikuussa 2026 => siirtovelka (jaksotus)
const DECEMBER_HEAT_LATE = { supplier: 'lampo', net: 4300 };

const BUDGET = {
  3000: 96000, 3100: 6800, 3200: 3600, 3550: 16800, 3900: 57600,
  4000: 10800, 4030: 600, 4100: 7700, 4210: 2600, 4250: 5000, 4300: 3100, 4500: 32000, 4600: 11800,
  4700: 3700, 4800: 5800, 4900: 120, 7000: 15000, 8000: 22000,
};

// ---------------------------------------------------------------------------
// Ajon tila ja odotetut luvut (lasketaan itse, verrataan raportteihin)
// ---------------------------------------------------------------------------
const expected = { revenue: {}, expense: {}, vatOut: 0, vatIn: 0 };
const addExp = (kind, acc, amount) => { expected[kind][acc] = r2((expected[kind][acc] || 0) + amount); };
const stats = { autoPosted: 0, manualPosted: 0, manualFixes: 0, noVoucherAck: 0, months: [] };
let company, fiscalYear, orgId, boardToken;
let bankBalance = 0; // pankkitilin saldo tiliotteen mukaan
const pendingVatPayments = []; // { key, amount } maksetaan seuraavan kuun tiliotteella

// ---------------------------------------------------------------------------
// 1. Käyttäjät ja yhtiö
// ---------------------------------------------------------------------------
async function setup() {
  log(`1. Käyttäjä ja yhtiö (${COMPANY_NAME})`);
  const reg = await api('/auth/register', { method: 'POST', body: USER });
  token = reg.data.token;
  const businessId = randomBusinessId();
  ({ data: company } = await api('/companies', {
    method: 'POST',
    body: { name: COMPANY_NAME, businessId, companyType: 'AS_OY', fiscalYearStart: `${YEAR}-01-01`, fiscalYearEnd: `${YEAR}-12-31` },
  }));
  console.log(`Yhtiö ${company.name}, Y-tunnus ${businessId}`);
  await api(`/companies/${company.id}`, { method: 'PATCH', body: { iban: COMPANY_IBAN, bic: 'NDEAFIHH' } });

  for (let i = 0; i < 30; i++) {
    const { data: accounts } = await api(`/accounting/accounts?companyId=${company.id}`);
    const { data: years } = await api(`/accounting/fiscal-years?companyId=${company.id}`);
    if (accounts.length && years.length) {
      fiscalYear = years.find((y) => y.startDate.startsWith(`${YEAR}-01-01`));
      console.log(`Tilikartta ${accounts.length} tiliä, tilikausi ${fiscalYear?.startDate.slice(0, 10)}–${fiscalYear?.endDate.slice(0, 10)}`);
      break;
    }
    await sleep(500);
  }
  if (!fiscalYear) throw new Error(`Tilikautta ${YEAR} ei syntynyt`);

  // Hallituksen jäsen: hyväksyy hallituksen rajan ylittävät laskut
  const { data: org } = await api('/organizations/me');
  orgId = org.id ?? org.organization?.id;
  const { data: inv } = await api(`/organizations/${orgId}/invitations`, {
    method: 'POST', body: { email: BOARD_USER.email, companyRoles: [{ companyId: company.id, role: 'BOARD' }] },
  });
  const tokenFromLink = String(inv.link).split('/').pop();
  await api(`/invitations/${tokenFromLink}/accept`, { method: 'POST', body: BOARD_USER, as: null });
  ({ data: { token: boardToken } } = await api('/auth/login', { method: 'POST', body: { email: BOARD_USER.email, password: BOARD_USER.password }, as: null }));
  console.log(`Hallituksen jäsen ${BOARD_USER.firstName} ${BOARD_USER.lastName} kutsuttu ja kirjautunut`);
}

// ---------------------------------------------------------------------------
// 2. Siirto vanhasta järjestelmästä
// ---------------------------------------------------------------------------
// Kirjanpitäjän oikea mäppäys esimerkkisaldoluettelolle (vanha tilikartta -> järjestelmän tilikartta)
const CORRECT_MAPPING = {
  1100: '1010', 1700: '1700', 1900: '1900', 2000: '2000', 2250: '2100', 2600: '2500', 2900: '2800',
  3000: '3000', 3050: '3900', 4000: '4000', 4100: '4100', 4500: '4500', 4800: '4800', 6900: '6900', 7700: '8000',
};
let opening = {};

async function migrate() {
  log('2. Siirto vanhasta: saldoluettelo 2024');
  const text = fs.readFileSync(path.join(__dirname, 'samples', 'saldoluettelo-2024.csv'), 'utf8');
  const { data: pv } = await api('/accounting/migration/preview', { method: 'POST', body: { companyId: company.id, text, signMode: 'DEBIT_POSITIVE' } });
  if (pv.errors?.length) note('VIRHE', `Saldoluettelon virheet: ${pv.errors.join('; ')}`);
  for (const w of pv.warnings || []) note('HUOM', `Saldoluettelo: ${w}`);
  const mapping = {};
  let wrong = 0;
  for (const r of pv.rows) {
    const want = CORRECT_MAPPING[r.sourceAccount];
    const tag = r.targetAccount === want ? 'ok' : `KORJATTU -> ${want}`;
    if (r.targetAccount !== want) wrong++;
    console.log(`  ${r.sourceAccount} ${String(r.sourceName).padEnd(32)} ehdotus ${r.targetAccount ?? '-'} ${String(r.targetName ?? '').padEnd(36)} (${r.how}) ${tag}`);
    mapping[r.sourceAccount] = want;
  }
  if (wrong) note('HUOM', `Siirto: ${wrong}/${pv.rows.length} tilin ehdotus piti korjata käsin`);
  console.log(`Täsmäys: debet ${eur(pv.totals.debit)}, kredit ${eur(pv.totals.credit)}, tulos ${eur(pv.totals.result)}; ehdotettu kausi ${pv.suggestedPeriod?.startDate}–${pv.suggestedPeriod?.endDate}`);
  const { data: imp } = await api('/accounting/migration/import', {
    method: 'POST',
    body: { companyId: company.id, text, signMode: 'DEBIT_POSITIVE', mapping, startDate: `${YEAR - 1}-01-01`, endDate: `${YEAR - 1}-12-31`, createOpening: true },
  });
  console.log(`Vertailukausi kirjattu (${imp.lines} tiliä, tulos ${eur(imp.result)}), avaustase ${imp.openingEntryId ? 'kirjattu' : 'PUUTTUU'}`);
  if (!imp.openingEntryId) note('VIRHE', 'Avaustasetta ei syntynyt siirrossa');

  // Avaussaldot tarkistusta varten
  const { data: ledger } = await api(`/accounting/ledger?companyId=${company.id}&fiscalYearId=${fiscalYear.id}`);
  const open = ledger.find((e) => e.entryType === 'OPENING');
  for (const l of open?.lines || []) opening[l.accountNumber] = r2((opening[l.accountNumber] || 0) + Number(l.debit) - Number(l.credit));
  bankBalance = opening['1900'] || 0;

  // Avaustaseen ostovelat laskuittain vanhan järjestelmän reskontrasta (maksut täsmäytyvät tiliotteelta)
  const payablesCsv = `Toimittaja;Laskunumero;Summa;Eräpäivä;Viite
Kiinteistöhuolto Vanha Oy;2024-1288;${fiAmount(-(opening['2800'] || 0))};15.1.${YEAR};`;
  const { data: pp } = await api('/accounting/migration/payables/preview', { method: 'POST', body: { companyId: company.id, text: payablesCsv } });
  if (pp.errors.length) note('VIRHE', `Avoimet ostolaskut: ${pp.errors.join('; ')}`);
  else {
    const { data: ip } = await api('/accounting/migration/payables', { method: 'POST', body: { companyId: company.id, text: payablesCsv } });
    console.log(`Avoimet ostolaskut vanhasta järjestelmästä: ${ip.created} kpl, ${eur(ip.total)} (= avaustaseen ostovelat)`);
  }
  console.log(`Avaustase: pankki ${eur(bankBalance)}, laina ${eur(-(opening['2500'] || 0))}, myyntisaamiset ${eur(opening['1700'] || 0)}, ostovelat ${eur(-(opening['2800'] || 0))}`);
}

// ---------------------------------------------------------------------------
// 3. Perustiedot
// ---------------------------------------------------------------------------
let components = [];
async function basics() {
  log('3. Osakasluettelo, vastikeperusteet, ALV, käyttöomaisuus, talousarvio');
  const csv = ['Huoneisto;Pinta-ala;Osakkeet;Omistaja;Sähköposti;Henkilöt;Autopaikat',
    ...APTS.map((a) => `${a.apt};${String(a.sqm).replace('.', ',')};${a.range};${a.owner};${a.owner.toLowerCase().replace(/[^a-zåäö]+/g, '.')}@example.com;${a.persons};${a.parking}`)].join('\n');
  const { data: dry } = await api('/shareholders/import', { method: 'POST', body: { companyId: company.id, csv, dryRun: true } });
  for (const w of dry.warnings || []) note('HUOM', `Osakasluettelo: ${w}`);
  const { data: imp } = await api('/shareholders/import', { method: 'POST', body: { companyId: company.id, csv } });
  console.log(`Osakasluettelo: ${imp.apartments} huoneistoa, ${imp.owners} omistajaa, ${TOTAL_SQM} m², ${TOTAL_SHARES} osaketta`);

  await api('/invoices/fees/defaults', { method: 'POST', body: { companyId: company.id } });
  const { data: setup } = await api(`/invoices/fees?companyId=${company.id}`);
  const price = { 3000: PRICES.hoito, 3900: PRICES.rahoitus, 3100: PRICES.vesi, 3200: PRICES.autopaikka };
  for (const c of setup.components) {
    await api(`/invoices/fees/components/${c.id}`, {
      method: 'PATCH', body: { unitPrice: price[c.accountNumber] ?? 0, ...(c.loanCapital ? { loanAmount: LOAN.principal } : {}) },
    });
  }
  ({ data: { components } } = await api(`/invoices/fees?companyId=${company.id}`));
  await api('/invoices/fees/settings', { method: 'PUT', body: { companyId: company.id, referenceRate: 2.5, reminderFee: 5, reminderDaysAfterDue: 14, paymentTermDays: 14 } });
  console.log(`Vastikkeet: ${components.map((c) => `${c.name} ${c.unitPrice} (${c.accountNumber})`).join(', ')}`);

  await api('/accounting/vat/settings', {
    method: 'PUT',
    body: { companyId: company.id, registered: true, period: 'QUARTER', deductionPercent: VAT_DEDUCTION_PCT, registeredFrom: `${YEAR}-01-01`, businessId: company.businessId, contactPhone: '040 123 4567' },
  });
  console.log(`ALV: verovelvollinen 1.1.${YEAR} alkaen (liiketila), neljännes, vähennysoikeus ${VAT_DEDUCTION_PCT} %`);

  await api('/accounting/assets', {
    method: 'POST',
    body: { companyId: company.id, name: 'Asuinrakennukset (A ja B)', accountNumber: '1010', acquisitionDate: '1995-06-01', acquisitionCost: 1100000, priorDepreciation: 250000, method: 'MANUAL', manualAmount: 25000 },
  });
  await api('/accounting/purchases/policy', { method: 'PUT', body: { companyId: company.id, boardLimit: 5000, debtorIban: COMPANY_IBAN, debtorBic: 'NDEAFIHH' } });
  await api(`/accounting/fiscal-years/${fiscalYear.id}/budget`, {
    method: 'PUT', body: { lines: Object.entries(BUDGET).map(([accountNumber, amount]) => ({ accountNumber, amount })) },
  });
  console.log('Käyttöomaisuus (rakennukset, poisto 25 000 €/v), hallituksen raja 5 000 €, talousarvio');
}

// ---------------------------------------------------------------------------
// 4. Kuukausi
// ---------------------------------------------------------------------------
let supplierInvoiceNo = 1000;
const purchaseMeta = []; // ladatut ostolaskut odotettuine arvoineen

function purchaseInvoice(key, net, m, { date, due, period } = {}) {
  const s = SUPPLIERS[key];
  const vat = r2(net * s.vat / 100);
  const total = r2(net + vat);
  const no = `${key.slice(0, 2).toUpperCase()}-${YEAR}-${++supplierInvoiceNo}`;
  const d = date ?? iso(YEAR, m, 3);
  const dueDate = due ?? iso(YEAR, m, 17);
  const per = period === false ? null : (period ?? [iso(YEAR, m, 1), iso(YEAR, m, lastDay(YEAR, m))]);
  return {
    key, supplier: s.name, businessId: s.bid, number: no, date: fiDate(d), due: fiDate(dueDate), isoDate: d, isoDue: dueDate,
    period: per ? per.map(fiDate) : null, lines: [[`${s.text} ${pad(m)}/${YEAR}`, fiAmount(net)]],
    net: fiAmount(net), vatRate: s.vat ? String(s.vat).replace('.', ',') : null, vat: fiAmount(vat), total: fiAmount(total),
    amount: total, netAmount: net, vatAmount: vat, ref: reference(`${supplierInvoiceNo}${m}`), iban: groupIban(s.iban), ibanRaw: s.iban,
    account: s.account, buyer: `${COMPANY_NAME}, Koekuja 1, 00100 Helsinki`, file: `${no}.pdf`,
  };
}

async function uploadPurchases(list) {
  const spec = path.join(OUT, `laskut-${list[0].number}.json`);
  fs.writeFileSync(spec, JSON.stringify(list), 'utf8');
  const pdfDir = path.join(OUT, 'ostolaskut');
  execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    [path.join(__dirname, 'samples', 'vuosiajo_laskut.py'), spec, pdfDir], { stdio: 'pipe' });
  for (const inv of list) {
    const form = new FormData();
    form.append('companyId', company.id);
    form.append('voucherType', 'PURCHASE');
    form.append('file', new Blob([fs.readFileSync(path.join(pdfDir, inv.file))], { type: 'application/pdf' }), inv.file);
    await api('/vouchers/upload', { method: 'POST', form });
    purchaseMeta.push(inv);
  }
  // Luku tapahtuu taustalla; odotetaan, että ostolaskut näkyvät kirjanpidossa
  const numbers = new Set(list.map((i) => i.number));
  for (let i = 0; i < 120; i++) {
    const { data: vouchers } = await api(`/vouchers?companyId=${company.id}`);
    const busy = vouchers.filter((v) => ['PENDING', 'PROCESSING'].includes(v.ocrStatus)).length;
    const { data: pis } = await api(`/accounting/purchase-invoices?companyId=${company.id}`);
    const seen = pis.filter((p) => numbers.has(p.invoiceNumber)).length;
    if (!busy && seen >= numbers.size) break;
    if (!busy && i > 40) break; // jokin lasku jäi syntymättä: raportoidaan alempana
    await sleep(500);
  }
}

/** Ostolaskujen tarkistus luetun tiedon ja todellisen välillä, hyväksyntä ja maksuaineisto. */
async function approveAndPay(m) {
  const { data } = await api(`/accounting/purchases?companyId=${company.id}`);
  const metaByNo = new Map(purchaseMeta.map((p) => [p.number, p]));
  const toPay = [];
  for (const inv of data.invoices) {
    if (inv.status === 'PAID' || inv.paymentBatch) continue;
    if (inv.invoiceDate < `${YEAR}-01-01`) continue; // vanhan järjestelmän lasku: maksettu tiliotteella
    const meta = metaByNo.get(inv.invoiceNumber);
    if (!meta) { note('VIRHE', `Ostolasku ${inv.supplierName} ${inv.invoiceNumber}: laskunumeroa ei tunnistettu`); continue; }
    if (meta.isoDate > iso(YEAR, 12, 31)) continue; // seuraavan vuoden lasku (jaksotus)
    if (r2(inv.totalAmount) !== meta.amount) note('VIRHE', `${meta.number}: summa luettiin ${inv.totalAmount}, oikea ${meta.amount}`);
    if (inv.dueDate?.slice(0, 10) !== meta.isoDue) note('VIRHE', `${meta.number}: eräpäivä ${inv.dueDate?.slice(0, 10)}, oikea ${meta.isoDue}`);
    if ((inv.iban || '') !== meta.ibanRaw) {
      note('HUOM', `${meta.number}: IBAN luettiin "${inv.iban}", korjataan`);
      await api(`/accounting/purchases/${inv.id}`, { method: 'PATCH', body: { iban: meta.ibanRaw } });
    }
    if (inv.approvalStatus !== 'APPROVED') {
      await api(`/accounting/purchases/${inv.id}/decision`, { method: 'POST', body: { decision: 'APPROVE' } });
      if (inv.needsBoard || meta.amount > 5000) {
        const { data: s } = await api(`/accounting/purchases/${inv.id}/decision`, { method: 'POST', body: { decision: 'APPROVE', comment: 'Hallitus hyväksyi kokouksessa' }, as: boardToken });
        console.log(`  ${meta.supplier} ${eur(meta.amount)}: isännöitsijä + hallitus hyväksyivät (${s.status})`);
      }
    }
    toPay.push({ inv, meta });
  }
  if (!toPay.length) return [];
  // Yksi maksuerä per eräpäivä
  const byDue = new Map();
  for (const p of toPay) byDue.set(p.meta.isoDue, [...(byDue.get(p.meta.isoDue) || []), p]);
  for (const [due, items] of byDue) {
    const { data: batch } = await api('/accounting/payment-batches', {
      method: 'POST', body: { companyId: company.id, invoiceIds: items.map((i) => i.inv.id), executionDate: due, debtorName: COMPANY_NAME },
    });
    const { data: xml } = await api(`/accounting/payment-batches/${batch.id}/xml`, { raw: true });
    fs.writeFileSync(path.join(OUT, `maksut-${due}.xml`), xml);
    await api(`/accounting/payment-batches/${batch.id}`, { method: 'PATCH', body: { status: 'SENT' } });
  }
  console.log(`  Maksuaineisto: ${toPay.length} laskua, ${eur(toPay.reduce((s, p) => s + p.meta.amount, 0))} (pain.001 tallennettu)`);
  return toPay.map((p) => p.meta);
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let ntrySeq = 0;
function camt053(m, entries, openingBal, closingBal) {
  const ntry = entries.sort((a, b) => a.date.localeCompare(b.date)).map((e) => `
      <Ntry>
        <NtryRef>VK${YEAR}${pad(m)}${String(++ntrySeq).padStart(4, '0')}</NtryRef>
        <Amt Ccy="EUR">${e.amount.toFixed(2)}</Amt>
        <CdtDbtInd>${e.cd}</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>${e.date}</Dt></BookgDt>
        <ValDt><Dt>${e.date}</Dt></ValDt>
        <AcctSvcrRef>${STAMP}${pad(m)}${String(ntrySeq).padStart(5, '0')}</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties>${e.cd === 'CRDT' ? `<Dbtr><Nm>${xmlEscape(e.name)}</Nm></Dbtr>` : `<Cdtr><Nm>${xmlEscape(e.name)}</Nm></Cdtr>`}</RltdPties>
          <RmtInf>${e.ref ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${e.ref}</Ref></CdtrRefInf></Strd>` : `<Ustrd>${xmlEscape(e.message)}</Ustrd>`}</RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>`).join('');
  const end = iso(YEAR, m, lastDay(YEAR, m));
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>VUOSIAJO-${STAMP}-${pad(m)}</MsgId><CreDtTm>${end}T23:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>VUOSIAJO-${STAMP}-${YEAR}-${pad(m)}</Id>
      <CreDtTm>${end}T23:00:00</CreDtTm>
      <FrToDt><FrDtTm>${iso(YEAR, m, 1)}T00:00:00</FrDtTm><ToDtTm>${end}T23:59:59</ToDtTm></FrToDt>
      <Acct><Id><IBAN>${COMPANY_IBAN}</IBAN></Id><Ccy>EUR</Ccy><Ownr><Nm>${xmlEscape(COMPANY_NAME)}</Nm></Ownr></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${Math.abs(openingBal).toFixed(2)}</Amt><CdtDbtInd>${openingBal >= 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd><Dt><Dt>${iso(YEAR, m, 1)}</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${Math.abs(closingBal).toFixed(2)}</Amt><CdtDbtInd>${closingBal >= 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd><Dt><Dt>${end}</Dt></Dt></Bal>${ntry}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;
}

let loanBalance = LOAN.principal;
const lateInvoices = []; // seuraavassa kuussa maksettavat
const noRefPayments = []; // viitteettömät suoritukset: kohdistetaan käsin

async function month(m) {
  const period = `${YEAR}-${pad(m)}`;
  log(`Kuukausi ${pad(m)}/${YEAR}`);
  const ms = { month: m, autoPosted: 0, manual: [], drafts: 0 };

  // Vastikkeet
  const { data: dry } = await api('/invoices/fees/run', { method: 'POST', body: { companyId: company.id, period, issueDate: iso(YEAR, m, 1), dueDate: iso(YEAR, m, 5), dryRun: true } });
  const { data: run } = await api('/invoices/fees/run', { method: 'POST', body: { companyId: company.id, period, issueDate: iso(YEAR, m, 1), dueDate: iso(YEAR, m, 5) } });
  console.log(`  Vastikelaskut: ${run.created} kpl, ${eur(run.total)}`);
  for (const row of dry.rows) for (const l of row.lines) addExp('revenue', l.accountNumber, l.amount);

  // Liiketilan vuokra (arvonlisäverollinen myyntilasku)
  const shopVat = r2(SHOP.rentNet * SHOP.vatRate / 100);
  const { data: shopInv } = await api('/invoices', {
    method: 'POST',
    body: {
      companyId: company.id, recipientName: SHOP.tenant, recipientEmail: SHOP.email, issueDate: iso(YEAR, m, 1), dueDate: iso(YEAR, m, 5),
      lines: [{ description: `Liiketilan vuokra ${pad(m)}/${YEAR}`, quantity: 1, unitPrice: SHOP.rentNet, vatRate: SHOP.vatRate, accountNumber: SHOP.account }],
    },
  });
  addExp('revenue', SHOP.account, SHOP.rentNet);
  expected.vatOut = r2(expected.vatOut + shopVat);
  if (r2(Number(shopInv.totalAmount)) !== r2(SHOP.rentNet + shopVat)) {
    note('VIRHE', `Liiketilan vuokralasku ${pad(m)}: summa ${shopInv.totalAmount}, pitäisi olla verollinen ${r2(SHOP.rentNet + shopVat)}`);
  }

  // Ostolaskut
  const list = monthlyPurchases(m).map(([key, net, withPeriod]) => purchaseInvoice(key, net, m, { period: withPeriod ? undefined : false }));
  if (m === 6) list.find((i) => i.key === 'korjaus').isoDue = iso(YEAR, 6, 28);
  for (const inv of list) inv.due = fiDate(inv.isoDue);
  await uploadPurchases(list);
  for (const inv of list) {
    const deductible = r2(inv.vatAmount * VAT_DEDUCTION_PCT / 100);
    addExp('expense', inv.account, r2(inv.netAmount + inv.vatAmount - deductible));
    expected.vatIn = r2(expected.vatIn + deductible);
  }
  const { data: pis } = await api(`/accounting/purchase-invoices?companyId=${company.id}`);
  for (const inv of list) {
    const pi = pis.find((p) => p.invoiceNumber === inv.number);
    if (!pi) { note('VIRHE', `${inv.supplier} ${inv.number}: ostolaskua ei syntynyt tositteesta`); continue; }
    if (pi.expenseAccount !== inv.account) note('HUOM', `${inv.supplier}: tiliehdotus ${pi.expenseAccount}, oikea ${inv.account} (korjataan käsittelyssä)`);
  }

  const paid = await approveAndPay(m);

  // Tiliote
  const entries = [];
  const { data: invoices } = await api(`/invoices?companyId=${company.id}`);
  for (const inv of invoices.filter((i) => i.issueDate.startsWith(period))) {
    const amount = Number(inv.totalAmount);
    if (inv.apartment === LATE.apt && m === LATE.month) { lateInvoices.push(inv); continue; }
    if (inv.apartment === NO_REF.apt && m === NO_REF.month) {
      entries.push({ cd: 'CRDT', amount, date: iso(YEAR, m, 5), name: inv.recipientName, message: `Vastike ${inv.apartment} ${pad(m)}/${YEAR}` });
      noRefPayments.push({ inv, amount, date: iso(YEAR, m, 5) });
      continue;
    }
    entries.push({ cd: 'CRDT', amount, date: iso(YEAR, m, inv.apartment === 'A 1' ? 3 : 5), name: inv.recipientName, ref: inv.referenceNumber });
  }
  for (const inv of lateInvoices.splice(0).filter(() => m > LATE.month)) {
    entries.push({ cd: 'CRDT', amount: Number(inv.totalAmount), date: iso(YEAR, m, 12), name: inv.recipientName, ref: inv.referenceNumber });
  }
  if (m === LATE.month) lateInvoices.push(...invoices.filter((i) => i.apartment === LATE.apt && i.period === period));
  // Vanhan järjestelmän avoimet saatavat (avaustaseen 1700) maksetaan tammikuussa vanhalla viitteellä
  if (m === 1 && opening['1700']) {
    entries.push({ cd: 'CRDT', amount: opening['1700'], date: iso(YEAR, 1, 9), name: 'Matti Demo', ref: reference('2024121') });
  }
  // ... ja vanhat ostovelat (avaustaseen 2800, tuotu laskuittain) maksetaan tammikuussa
  if (m === 1 && opening['2800']) {
    entries.push({ cd: 'DBIT', amount: -opening['2800'], date: iso(YEAR, 1, 15), name: 'Kiinteistöhuolto Vanha Oy', message: 'Lasku 2024-12 joulukuun huolto', oldPayable: true });
  }
  for (const p of paid) {
    entries.push({ cd: 'DBIT', amount: p.amount, date: p.isoDue, name: p.supplier, ref: p.ref.replace(/\s/g, '') });
  }
  // Laina: lyhennys ja korko erikseen kuun 20. päivä
  const interest = r2(loanBalance * LOAN.rate / 12);
  entries.push({ cd: 'DBIT', amount: LOAN.monthlyAmortization, date: iso(YEAR, m, 20), name: 'Rahoituspankki Oyj', message: `Lainan 7788 lyhennys ${pad(m)}/${YEAR}` });
  entries.push({ cd: 'DBIT', amount: interest, date: iso(YEAR, m, 20), name: 'Rahoituspankki Oyj', message: `Lainan 7788 korko ${pad(m)}/${YEAR}` });
  loanBalance = r2(loanBalance - LOAN.monthlyAmortization);
  addExp('expense', '8000', interest);
  // Pankin palvelumaksu
  entries.push({ cd: 'DBIT', amount: 9.9, date: iso(YEAR, m, lastDay(YEAR, m)), name: 'Rahoituspankki Oyj', message: `Palvelumaksu ${pad(m)}/${YEAR}` });
  addExp('expense', '4900', 9.9);
  // Edellisen neljänneksen arvonlisävero
  for (const v of pendingVatPayments.splice(0)) {
    if (v.amount > 0) entries.push({ cd: 'DBIT', amount: v.amount, date: iso(YEAR, m, 12), name: 'Verohallinto', message: `Arvonlisävero ${v.key}`, vat: true });
    if (v.amount < 0) entries.push({ cd: 'CRDT', amount: -v.amount, date: iso(YEAR, m, 20), name: 'Verohallinto', message: `Arvonlisäveron palautus ${v.key}`, vat: true });
  }

  const statementOpening = bankBalance;
  const delta = entries.reduce((s, e) => s + (e.cd === 'CRDT' ? e.amount : -e.amount), 0);
  bankBalance = r2(bankBalance + delta);
  const xml = camt053(m, entries, statementOpening, bankBalance);
  const file = path.join(OUT, `tiliote-${period}.xml`);
  fs.writeFileSync(file, xml, 'utf8');
  const form = new FormData();
  form.append('companyId', company.id);
  form.append('file', new Blob([xml], { type: 'application/xml' }), path.basename(file));
  const { data: up } = await api('/bank/upload-statement', { method: 'POST', form });
  console.log(`  Tiliote: ${up.transactionCount} tapahtumaa, saldo ${eur(bankBalance)}`);
  // Kirjaukset syntyvät tapahtumaväylän kautta; odotetaan
  const prefix = (e) => e.lines?.some((l) => l.accountNumber === '1900');
  for (let i = 0, prev = -1; i < 40; i++) {
    await sleep(500);
    const { data: led } = await api(`/accounting/ledger?companyId=${company.id}`);
    const n = led.filter((e) => e.entryDate.startsWith(period) && prefix(e)).length;
    if (n >= entries.length || (n === prev && n > 0 && i > 6)) break;
    prev = n;
  }

  await processDrafts(m, ms);
  await reconcileBank(m);
  stats.months.push(ms);
}

/** Viitteettömän suorituksen kohdistus käsin (Reskontra) ja pankkiviennin tilin korjaus. */
async function allocateNoRef(entry) {
  const p = noRefPayments.find((x) => Math.abs(x.amount - Number(entry.lines.find((l) => l.accountNumber === '1900')?.debit || 0)) < 0.005);
  if (!p) return false;
  await api(`/invoices/${p.inv.id}/payments`, { method: 'POST', body: { amount: p.amount, paidOn: p.date, note: 'Viitteetön suoritus kohdistettu käsin' } });
  noRefPayments.splice(noRefPayments.indexOf(p), 1);
  return '1700';
}

/** Käsittelemättömät: "Hyväksy kaikki varmat", sitten loput kuten isännöitsijä tekisi dashboardissa. */
async function processDrafts(m, ms) {
  const period = `${YEAR}-${pad(m)}`;
  const { data: auto } = await api('/accounting/entries/post-auto', { method: 'POST', body: { companyId: company.id } });
  ms.autoPosted += auto.posted;
  stats.autoPosted += auto.posted;
  const { data: ledger } = await api(`/accounting/ledger?companyId=${company.id}&status=DRAFT`);
  const drafts = ledger.filter((e) => e.status === 'DRAFT' && e.entryDate.slice(0, 7) <= period);
  ms.drafts = drafts.length;
  const byNo = new Map(purchaseMeta.map((p) => [p.number, p]));
  for (const e of drafts) {
    const text = `${e.description} ${(e.lines || []).map((l) => l.description).join(' ')}`;
    let fixAccount = null;
    let ack = false;
    let why = '';
    const suspense = e.lines.find((l) => l.accountNumber === '1990');
    // Ostolaskun kuluvienti: tarkistetaan tili
    const meta = [...byNo.values()].find((p) => text.includes(p.number) || (e.purchaseInvoice && e.purchaseInvoice.invoiceNumber === p.number));
    const expenseLine = e.lines.find((l) => Number(l.accountNumber) >= 4000 && Number(l.debit) > 0);
    if (meta && expenseLine && expenseLine.accountNumber !== meta.account) { fixAccount = meta.account; why = `ostolasku ${meta.supplier}: tili ${expenseLine.accountNumber} -> ${meta.account}`; }
    // Tiliotteen tositteettomat menot: oikea tili viestin perusteella (kuten isännöitsijä tarkistaisi)
    const bankDebit = !meta && e.lines.find((l) => Number(l.debit) > 0 && l.accountNumber !== '1900');
    const want = /lyhennys/i.test(text) ? ['2500', 'lainan lyhennys'] : /korko/i.test(text) ? ['8000', 'lainan korko']
      : /arvonlisävero|verohallinto/i.test(text) ? ['2885', 'ALV-maksu'] : /palvelumaksu/i.test(text) ? ['4900', 'pankkikulu'] : null;
    if (bankDebit && want) {
      ack = true;
      if (bankDebit.accountNumber !== want[0]) {
        fixAccount = want[0];
        why = `${want[1]}: tili ${bankDebit.accountNumber} -> ${want[0]}`;
        if (bankDebit.accountNumber !== '1990') note('HUOM', `${pad(m)}: ${want[1]} ehdotettiin tilille ${bankDebit.accountNumber}, korjattiin ${want[0]}`);
      } else why = `${want[1]} (tili oikein)`;
    }
    if (suspense && !fixAccount) {
      if (/arvonlisävero|verohallinto/i.test(text)) { fixAccount = '2885'; why = 'ALV-palautus'; }
      else if (Number(suspense.credit) > 0) { fixAccount = await allocateNoRef(e); why = 'viitteetön vastikesuoritus kohdistettu'; }
      else if (meta) { fixAccount = meta.account; why = `ostolasku ${meta.supplier}`; }
      if (!fixAccount) { note('VIRHE', `${pad(m)}: selvitettävä vienti jäi ratkaisematta: ${e.description} ${eur(Number(suspense.debit) || Number(suspense.credit))}`); continue; }
    }
    if (!why && /Viitettä ei löydy/.test(e.reviewNote || '')) why = 'vanhan järjestelmän saatava (viite tuntematon)';
    if (!why) why = e.createdBy === 'system-invoicing' ? 'oma lasku' : e.createdBy === 'system-voucher' || meta ? 'ostolasku (tili oikein)' : e.createdBy === 'system-bank' ? 'pankkitapahtuma' : 'muu';
    if (e.needsVoucher && !e.voucherId) {
      if (/lyhennys|korko|palvelumaksu|arvonlisävero|verohallinto/i.test(text)) ack = true;
      else note('HUOM', `${pad(m)}: tositteeton vienti hyväksyttiin tiliotteen perusteella: ${e.description}`);
      ack = true;
    }
    if (fixAccount) {
      const target = suspense ? '1990' : bankDebit ? bankDebit.accountNumber : expenseLine.accountNumber;
      const lines = e.lines.map((l) => ({
        accountNumber: l.accountNumber === target ? fixAccount : l.accountNumber,
        debit: Number(l.debit), credit: Number(l.credit), description: l.description,
        ...(l.vatCode ? { vatCode: l.vatCode } : {}), ...(l.vatAmount != null ? { vatAmount: Number(l.vatAmount) } : {}),
      }));
      await api(`/accounting/entries/${e.id}`, { method: 'PATCH', body: { description: e.description, lines } });
      stats.manualFixes++;
    }
    const { status, data } = await api(`/accounting/entries/${e.id}/post`, { method: 'POST', body: { acknowledgeMissingVoucher: ack }, allow: [400, 409] });
    if (status !== 200) { note('VIRHE', `${pad(m)}: viennin ${e.voucherNumber} hyväksyntä epäonnistui: ${data?.error}`); continue; }
    if (ack) stats.noVoucherAck++;
    stats.manualPosted++;
    ms.manual.push(why || 'luonnos hyväksytty käsin');
  }
  const counts = ms.manual.reduce((c, w) => { const k = w.split(':')[0]; c[k] = (c[k] || 0) + 1; return c; }, {});
  console.log(`  Käsittelemättömät: automaatti hyväksyi ${auto.posted}, käsin ${ms.manual.length} (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || '-'})`);
  for (const s of auto.skipped || []) console.log(`    ohitettu: ${s.voucherNumber}: ${s.reason}`);
}

async function reconcileBank(m) {
  const { data } = await api(`/accounting/bank-reconciliation?companyId=${company.id}&year=${YEAR}`);
  const row = (data.months || []).find((r) => r.key === `${YEAR}-${pad(m)}`);
  if (!row) { note('VIRHE', `Pankkitäsmäytys ${pad(m)}: kuukautta ei löytynyt`); return; }
  if (row.status !== 'OK') {
    note('VIRHE', `Pankkitäsmäytys ${pad(m)}: ${row.status} (pankki ${row.bank}, kirjanpito ${row.book}, ero ${row.difference}, luonnoksia ${row.drafts?.count})`);
    return;
  }
  const { status, data: mk } = await api('/accounting/bank-reconciliation/mark', { method: 'POST', body: { companyId: company.id, key: row.key, reconciled: true }, allow: [400, 409] });
  if (status !== 200) note('VIRHE', `Pankkitäsmäytyksen merkintä ${pad(m)}: ${mk?.error}`);
}

// ---------------------------------------------------------------------------
// 5. Arvonlisävero
// ---------------------------------------------------------------------------
const vatTotals = { output: 0, deductible: 0, paid: 0 };
async function vatQuarter(q) {
  const key = `${YEAR}-Q${q}`;
  const { data: r } = await api(`/accounting/vat/return?companyId=${company.id}&period=${key}`);
  const f = Object.fromEntries(r.fields.map((x) => [x.code, x.amount]));
  console.log(`  ALV ${key}: myynnin vero ${eur(f[301] ?? 0)}, vähennettävä ${eur(f[307] ?? 0)}, maksettava ${eur(r.payable)}${r.warnings.length ? ` (varoitukset: ${r.warnings.join(' | ')})` : ''}`);
  vatTotals.output = r2(vatTotals.output + (f[301] ?? 0) + (f[302] ?? 0) + (f[303] ?? 0));
  vatTotals.deductible = r2(vatTotals.deductible + (f[307] ?? 0));
  const { data: s } = await api('/accounting/vat/settle', { method: 'POST', body: { companyId: company.id, period: key }, allow: [400, 409] });
  if (s?.error) { note('VIRHE', `ALV-tilitys ${key}: ${s.error}`); return; }
  pendingVatPayments.push({ key, amount: r.payable });
  vatTotals.paid = r2(vatTotals.paid + r.payable);
}

// ---------------------------------------------------------------------------
// 6. Tilinpäätös
// ---------------------------------------------------------------------------
async function yearEnd() {
  log(`6. Tilinpäätös ${YEAR}`);
  // Joulukuun lämpölasku saapuu tammikuussa (laskupäivä 2026) => siirtovelka
  const late = purchaseInvoice(DECEMBER_HEAT_LATE.supplier, DECEMBER_HEAT_LATE.net, 12, {
    date: iso(YEAR + 1, 1, 7), due: iso(YEAR + 1, 1, 21), period: [iso(YEAR, 12, 1), iso(YEAR, 12, 31)],
  });
  await uploadPurchases([late]);
  const { data: acc } = await api(`/accounting/fiscal-years/${fiscalYear.id}/accruals`);
  console.log(`Jaksotusehdotukset: ${acc.suggestions.length}`);
  for (const s of acc.suggestions) {
    console.log(`  ${s.kind} ${s.accountNumber} ${eur(s.amount)} ${s.description}`);
    await api(`/accounting/fiscal-years/${fiscalYear.id}/accruals`, { method: 'POST', body: s });
    // Kuluksi kuuluu laskun summa ilman vähennettävää arvonlisäveroa (vähennys tehdään laskun kaudella)
    addExp('expense', s.accountNumber, r2(late.amount - r2(late.vatAmount * VAT_DEDUCTION_PCT / 100)));
  }
  if (!acc.suggestions.length) note('VIRHE', 'Joulukuun lämpölaskusta (laskupäivä tammikuussa) ei tullut jaksotusehdotusta');

  const { data: dep } = await api(`/accounting/fiscal-years/${fiscalYear.id}/depreciation`);
  await api(`/accounting/fiscal-years/${fiscalYear.id}/depreciation`, { method: 'POST', body: { items: dep.map((d) => ({ assetId: d.asset.id, amount: d.amount })) } });
  for (const d of dep) addExp('expense', '6900', d.amount);
  console.log(`Poistot: ${dep.map((d) => `${d.asset.name} ${eur(d.amount)}`).join(', ')}`);

  const { data: cl } = await api(`/accounting/fiscal-years/${fiscalYear.id}/closing-checklist`);
  for (const i of cl.items) console.log(`  ${i.ok ? 'OK ' : (i.blocking ? 'EST' : 'VAR')} ${i.label}: ${i.detail}`);
  const blocking = cl.items.filter((i) => i.blocking && !i.ok);
  if (blocking.length) {
    // Näytetään, mitä jäi
    const { data: drafts } = await api(`/accounting/ledger?companyId=${company.id}&status=DRAFT`);
    for (const d of drafts.filter((e) => e.entryDate.startsWith(String(YEAR)))) console.log(`    luonnos: ${d.entryDate.slice(0, 10)} ${d.voucherNumber} ${d.description}`);
  }

  // Raportit ennen sulkemista (tarkistus)
  await verifyReports('ennen sulkemista');

  const { status, data: closed } = await api(`/accounting/fiscal-years/${fiscalYear.id}/close`, { method: 'POST', body: { acknowledgeWarnings: true }, allow: [409] });
  if (status !== 200) { note('VIRHE', `Tilikauden sulkeminen: ${closed.error}`); return false; }
  console.log(`Tilikausi suljettu: tulos ${eur(closed.result ?? 0)}, lukittu ${closed.lockedEntries} vientiä, seuraava kausi ${closed.nextFiscalYear?.startDate?.slice(0, 10)}, jaksotusten purkuja ${closed.accrualReversals}`);
  return true;
}

async function closingPackage() {
  log('Tilinpäätöspaketti, allekirjoitus ja arkistointi');
  const { data: pkg } = await api(`/reports/closing-package?companyId=${company.id}&fiscalYearId=${fiscalYear.id}`);
  const placeholders = JSON.stringify(pkg).match(/\[[^\]]{3,120}\]/g) || [];
  console.log(`Toimintakertomuspohjassa ${placeholders.length} täydennettävää kohtaa`);
  const report = {
    general: `${COMPANY_NAME} on asunto-osakeyhtiö Helsingissä. Yhtiökokous pidettiin 15.5.${YEAR}.`,
    property: 'Yhtiön omistamalla tontilla on kaksi asuinrakennusta (valmistunut 1995), 12 asuinhuoneistoa ja yksi liiketila. Huoneistoala 1 600 m².',
    repairs: `Tilikaudella korjattiin B-talon julkisivu (${eur(SUPPLIERS.korjaus ? 12800 : 0)} alv 0). Muut korjaukset olivat vuosikorjauksia.`,
    maintenance_plan: 'Seuraavan viiden vuoden aikana suunnitellaan vesikaton uusimista (2027, arvio 180 000 €) ja ikkunoiden huoltomaalausta (2028, arvio 40 000 €).',
    events: 'Tilikauden päättymisen jälkeen ei ole tapahtunut olennaisia muutoksia yhtiön asemassa.',
  };
  const { status: putStatus, data: saved } = await api(`/accounting/fiscal-years/${fiscalYear.id}/closing-package`, {
    method: 'PUT', allow: [400],
    body: {
      report,
      signers: [{ name: 'Pekka Puheenjohtaja', role: 'hallituksen puheenjohtaja' }, { name: 'Helmi Hallitus', role: 'hallituksen jäsen' }, { name: 'Iida Isännöitsijä', role: 'isännöitsijä' }],
      signPlace: 'Helsinki', signDate: `${YEAR + 1}-03-10`, auditorName: 'Tiina Tarkastaja', auditorKind: 'INSPECTOR',
    },
  });
  if (putStatus !== 200) note('VIRHE', `Tilinpäätöspaketin tallennus: ${saved.error}`);
  else console.log(`Toimintakertomus tallennettu (osiot: ${Object.keys(saved.report || {}).join(', ')})`);

  const pdfs = ['closing-package', 'balance-details', 'journal', 'general-ledger'];
  for (const p of pdfs) {
    const { status: st, data } = await api(`/reports/${p}/pdf?companyId=${company.id}&fiscalYearId=${fiscalYear.id}`, { raw: true, allow: [400, 404, 500] });
    if (st !== 200) { note('VIRHE', `PDF ${p}: ${JSON.stringify(data).slice(0, 200)}`); continue; }
    fs.writeFileSync(path.join(OUT, `${p}-${YEAR}.pdf`), data);
    console.log(`  PDF ${p}: ${Math.round(data.length / 1024)} kt`);
  }
  const { status: sg, data: signed } = await api(`/accounting/fiscal-years/${fiscalYear.id}/closing-package`, { method: 'PUT', body: { signed: true }, allow: [400, 409] });
  if (sg !== 200) note('VIRHE', `Allekirjoitetuksi merkintä: ${signed.error}`);
  else console.log(`Tilinpäätös merkitty allekirjoitetuksi ${signed.package?.signedAt?.slice(0, 10) ?? signed.signedAt?.slice(0, 10) ?? ''}`);
  const arch = signed?.archive;
  // Palvelin arkistoi allekirjoituksen yhteydessä (vastauksessa archive)
  if (!arch || arch.error) note('VIRHE', `Tilinpäätöksen arkistointi allekirjoituksen yhteydessä: ${arch?.error ?? 'vastauksessa ei arkistointitietoa'}`);
  else {
    console.log(`Arkistoitu: ${arch.archived.join(', ')}; säilytys ${String(arch.retentionUntil).slice(0, 10)} asti`);
    if (arch.archived.length < 4) note('VIRHE', `Tilinpäätöksen arkistointi: odotettiin 4 asiakirjaa, arkistoitiin ${arch.archived.length}`);
  }
}

async function taxReturn() {
  log('Veroilmoitus 4');
  const { data: t } = await api(`/accounting/fiscal-years/${fiscalYear.id}/tax-return`);
  console.log(`  ${''.padEnd(58)} ${'Kirjanpito'.padStart(14)} ${'Verotus'.padStart(14)}`);
  for (const r of t.rows) console.log(`  ${String(r.label).padEnd(58)} ${eur(r.books ?? 0).padStart(14)} ${eur(r.tax ?? 0).padStart(14)}`);
  for (const w of t.warnings || []) console.log(`  ! ${w}`);
  const tt = t.totals || {};
  console.log(`  Tulos kirjanpidossa ${eur(tt.booksResult ?? 0)}; verotettava tulo ${eur(tt.taxableIncome ?? 0)}, vahvistettava tappio ${eur(tt.confirmedLoss ?? 0)}; määräpäivä noin ${String(t.dueHint).slice(0, 10)}`);
  const expResult = r2(Object.values(expected.revenue).reduce((s, v) => s + v, 0) - Object.values(expected.expense).reduce((s, v) => s + v, 0));
  check('Veroilmoitus 4: tulos kirjanpidon mukaan', tt.booksResult ?? 0, expResult);
  check('Veroilmoitus 4: korkomenot', (t.rows.find((r) => r.key === 'korkomenot') || {}).books ?? 0, expected.expense['8000'] || 0);
  fs.writeFileSync(path.join(OUT, `veroilmoitus4-${YEAR}.json`), JSON.stringify(t, null, 2));
  return t;
}

// ---------------------------------------------------------------------------
// 7. Tarkistus
// ---------------------------------------------------------------------------
// Raportin rivit: { account, label, amount, previous } (ryhmät toistavat samat rivit, joten vain rows)
const flatRows = (sections) => (sections || []).flatMap((s) => (s.rows || []).map((r) => ({ ...r, accountNumber: r.account ?? r.accountNumber })));

async function verifyReports(when) {
  log(`7. Raporttien tarkistus (${when})`);
  const q = `companyId=${company.id}&fiscalYearId=${fiscalYear.id}`;
  const { data: income } = await api(`/reports/income-statement?${q}`);
  const { data: balance } = await api(`/reports/balance-sheet?${q}`);
  const { data: vastike } = await api(`/reports/maintenance-calculation?${q}`);
  fs.writeFileSync(path.join(OUT, `raportit-${when.replace(/\s/g, '-')}.json`), JSON.stringify({ income, balance, vastike }, null, 2));

  // Tilikohtaiset luvut tuloslaskelmasta
  const rows = flatRows(income.sections);
  const amountOf = (acc) => r2(rows.filter((r) => String(r.accountNumber) === String(acc)).reduce((s, r) => s + Number(r.amount), 0));
  for (const [acc, v] of Object.entries(expected.revenue).sort()) check(`Tuotto ${acc}`, amountOf(acc), v);
  for (const [acc, v] of Object.entries(expected.expense).sort()) check(`Kulu ${acc}`, Math.abs(amountOf(acc)), v);
  const expResult = r2(Object.values(expected.revenue).reduce((s, v) => s + v, 0) - Object.values(expected.expense).reduce((s, v) => s + v, 0));
  const resultRow = (income.sections || []).filter((s) => s.subtotal).pop();
  check('Tilikauden tulos', resultRow?.total ?? income.result ?? 0, expResult);
  if (!balance.balanced) note('VIRHE', `Tase ei täsmää (${when}): vastaavaa ${balance.assets?.total}, vastattavaa ${balance.equity?.total}`);
  else console.log(`  OK  Tase täsmää: ${eur(balance.assets.total)}`);
  const bankRow = flatRows(balance.sections?.assets).find((r) => String(r.accountNumber) === '1900');
  check('Pankkitili 1900 = tiliotteen saldo', bankRow?.amount ?? 0, bankBalance);
  const loanRow = flatRows(balance.sections?.liabilities).find((r) => String(r.accountNumber) === '2500');
  check('Laina 2500', Math.abs(loanRow?.amount ?? 0), loanBalance);
  const recv = flatRows(balance.sections?.assets).find((r) => String(r.accountNumber) === '1700');
  check('Myyntisaamiset 1700 (kaikki maksettu)', recv?.amount ?? 0, 0);
  const payables = flatRows(balance.sections?.liabilities).find((r) => String(r.accountNumber) === '2800');
  check('Ostovelat 2800 (kaikki maksettu)', payables?.amount ?? 0, 0);
  const accrued = flatRows(balance.sections?.liabilities).find((r) => String(r.accountNumber) === '2900');
  check('Siirtovelat 2900 (joulukuun lämpö)', accrued?.amount ?? 0, r2(DECEMBER_HEAT_LATE.net * 1.255 - r2(DECEMBER_HEAT_LATE.net * 0.255 * VAT_DEDUCTION_PCT / 100)));
  const { data: resk } = await api(`/invoices/reskontra?companyId=${company.id}`);
  const openInv = resk.invoices.filter((i) => i.open > 0.005);
  check('Vastikereskontra: avoimet laskut', openInv.reduce((s, i) => s + i.open, 0), 0);
  for (const i of openInv) console.log(`    avoinna: ${i.apartment ?? i.recipientName} ${i.period ?? ''} ${eur(i.open)}`);
  const m = vastike.maintenance_fund;
  const c = vastike.capital_fund;
  console.log(`  Vastikelaskelma: hoitorahoitus ${eur(m.income)} - ${eur(m.expenses)} = ${eur(m.surplus)}; pääomarahoitus ${eur(c.income)} - ${eur(c.expenses)} = ${eur(c.surplus)}`);
  const capitalIncome = expected.revenue['3900'] || 0;
  check('Vastikelaskelma: pääomavastikkeet', c.income, capitalIncome);
  check('Vastikelaskelma: lainojen lyhennykset + korot', Math.abs(c.expenses), r2(LOAN.monthlyAmortization * 12 + (expected.expense['8000'] || 0)));
  return { income, balance, vastike };
}

// ---------------------------------------------------------------------------
(async () => {
  const t0 = Date.now();
  console.log(`Vuosiajo ${YEAR} -> ${BASE}\nTulokset: ${OUT}`);
  await setup();
  await migrate();
  await basics();
  for (let m = 1; m <= 12; m++) {
    await month(m);
    if (m % 3 === 0) await vatQuarter(m / 3);
  }
  log('ALV koko vuosi');
  check('ALV: myynnin vero (vuokrat)', vatTotals.output, expected.vatOut);
  check('ALV: vähennettävä vero', vatTotals.deductible, expected.vatIn, 0.05);
  // Q4:n vero maksetaan helmikuussa 2026 => jää taseeseen 2885
  const closedOk = await yearEnd();
  if (closedOk) {
    await verifyReports('suljettu');
    await closingPackage();
    await taxReturn();
  }
  const errors = findings.filter((f) => f.level === 'VIRHE');
  const failed = checks.filter((c) => !c.ok);
  log('Yhteenveto');
  console.log(`Kesto ${Math.round((Date.now() - t0) / 1000)} s. Viennit: automaatti hyväksyi ${stats.autoPosted}, käsin ${stats.manualPosted} (tilikorjauksia ${stats.manualFixes}, tiliote tositteena ${stats.noVoucherAck}).`);
  console.log(`Tarkistuksia ${checks.length}, eroja ${failed.length}. Havaintoja: virheitä ${errors.length}, huomioita ${findings.length - errors.length}.`);
  for (const f of findings) console.log(`  [${f.level}] ${f.msg}`);
  fs.writeFileSync(path.join(OUT, 'yhteenveto.json'), JSON.stringify({ company: { id: company?.id, name: COMPANY_NAME }, user: USER.email, stats, checks, findings, expected }, null, 2));
  console.log(`\nKirjaudu: http://localhost:3000  ${USER.email} / ${USER.password}`);
  process.exitCode = errors.length || failed.length ? 1 : 0;
})().catch((err) => {
  console.error(`\nVUOSIAJO KESKEYTYI: ${err.stack || err.message}`);
  if (findings.length) for (const f of findings) console.log(`  [${f.level}] ${f.msg}`);
  process.exit(2);
});
