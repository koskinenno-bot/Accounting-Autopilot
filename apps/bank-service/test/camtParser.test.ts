import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidFinnishReference, parseCamt053 } from '../src/services/camtParser';

const camt = (ustrd: string) => `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
  <Ntry><NtryRef>1</NtryRef><Amt Ccy="EUR">1359.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2025-03-05</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Tiina Tarkastaja</Nm></Dbtr></RltdPties><RmtInf><Ustrd>${ustrd}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

test('vapaan viestin numero tulkitaan viitteeksi vain, jos tarkiste täsmää', () => {
  assert.equal(isValidFinnishReference('1232'), true);
  assert.equal(isValidFinnishReference('2025'), false);
  assert.equal(isValidFinnishReference('0000'), false);
  // Vuosiajo: "Vastike B 9 03/2025" kirjautui viitesuoritukseksi viitteellä 2025
  assert.equal(parseCamt053(camt('Vastike B 9 03/2025'))[0].referenceNumber, undefined);
  assert.equal(parseCamt053(camt('Viite 1232 vastike'))[0].referenceNumber, '1232');
});
