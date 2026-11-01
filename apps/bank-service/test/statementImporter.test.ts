import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, StatementError } from '../src/services/statementImporter';

test('tiliotteen muoto tunnistetaan sisällöstä', () => {
  assert.equal(detectFormat(Buffer.from('%PDF-1.7\n...')), 'pdf');
  assert.equal(detectFormat(Buffer.from('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>')), 'camt053');
  assert.equal(detectFormat(Buffer.from('Kirjauspäivä;Määrä\n1.11.2026;-1,00'), 'tiliote.txt'), 'csv');
  assert.throws(() => detectFormat(Buffer.from('<html><body>ei tiliote</body></html>')), StatementError);
});
