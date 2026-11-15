import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, StatementError } from '../src/services/statementImporter';

test('tiliotteen muoto tunnistetaan sisällöstä', () => {
  assert.equal(detectFormat(Buffer.from('%PDF-1.7\n...')), 'pdf');
  assert.equal(detectFormat(Buffer.from('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>')), 'camt053');
  assert.equal(detectFormat(Buffer.from('Kirjauspäivä;Määrä\n1.11.2026;-1,00'), 'tiliote.txt'), 'csv');
  assert.throws(() => detectFormat(Buffer.from('<html><body>ei tiliote</body></html>')), StatementError);
});

test('camt.053: loppusaldo (CLBD) ja IBAN pankkitäsmäytykseen', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseCamtClosingBalance } = require('../src/services/camtParser');
  const xml = (ind: string) => `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
    <Acct><Id><IBAN>FI21 1234 5600 0007 85</IBAN></Id></Acct>
    <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-31</Dt></Dt></Bal>
    <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">12345.67</Amt><CdtDbtInd>${ind}</CdtDbtInd><Dt><Dt>2026-11-30</Dt></Dt></Bal>
  </Stmt></BkToCstmrStmt></Document>`;
  assert.deepEqual(parseCamtClosingBalance(xml('CRDT')), { iban: 'FI2112345600000785', date: '2026-11-30', amount: 12345.67 });
  assert.equal(parseCamtClosingBalance(xml('DBIT')).amount, -12345.67);
  assert.equal(parseCamtClosingBalance('<Document><BkToCstmrStmt><Stmt></Stmt></BkToCstmrStmt></Document>'), null);
});
