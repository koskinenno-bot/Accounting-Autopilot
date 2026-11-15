import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, renderEmail, textToHtml } from '../src/delivery';

test('tekstiviesti: rivinvaihdot ja linkit, HTML-merkit suojattu', async () => {
  assert.equal(textToHtml('a <b>\nhttps://x.fi/a?b=1'), 'a &lt;b&gt;<br><a href="https://x.fi/a?b=1" style="color:#2563eb">https://x.fi/a?b=1</a>');
  const r = await renderEmail('Otsikko', undefined, { body: 'Hei\n\nrivi' });
  assert.equal(r.text, 'Hei\n\nrivi');
  assert.match(r.html, /<title>Otsikko<\/title>/);
});

test('pohjat: kutsu ja vastikelasku, tekstiversio taulukosta', async () => {
  const inv = await renderEmail('Kutsu', 'invitation', { inviterName: 'Isä <x>', organizationName: 'Toimisto', link: 'http://l/i/1', days: 14 });
  assert.match(inv.html, /Isä &lt;x&gt; kutsui/);
  assert.match(inv.text, /Hyväksy kutsu \(http:\/\/l\/i\/1\)/);
  const bill = await renderEmail('Lasku', 'invoice-notification', { recipientName: 'O', invoiceNumber: '1', amount: '245.5', dueDate: '1.12.2026', referenceNumber: '13' });
  assert.match(bill.text, /Summa: 245,50 €/);
});

test('tuntematon tai vaarallinen pohjan nimi hylätään', async () => {
  await assert.rejects(renderEmail('x', '../../etc/passwd', {}), /Tuntematon viestipohja/);
  const fallback = await renderEmail('x', '../x', { body: 'teksti' });
  assert.equal(fallback.text, 'teksti');
});

test('htmlToText', () => {
  assert.equal(htmlToText('<p>a<br>b</p><table><tr><td>K</td><td>V</td></tr></table>'), 'a\nb\n\nK: V');
});
