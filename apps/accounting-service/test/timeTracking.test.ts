import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatCounts, dayOf, manualEntryProblem, summarize } from '../src/timeTracking';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

test('merkki lasketaan vain minuutin välein', () => {
  const now = new Date('2026-11-15T10:00:00Z');
  assert.equal(beatCounts(null, now), true);
  assert.equal(beatCounts(new Date('2026-11-15T09:59:30Z'), now), false);
  assert.equal(beatCounts(new Date('2026-11-15T09:59:00Z'), now), true);
});

test('päivä vaihtuu Suomen ajan mukaan', () => {
  // 23.30 UTC = 01.30 Suomen aikaa seuraavana päivänä
  assert.equal(dayOf(new Date('2026-11-15T23:30:00Z')).toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(dayOf(new Date('2026-11-15T12:00:00Z')).toISOString(), '2026-11-15T00:00:00.000Z');
});

test('käsin kirjattavan ajan tarkistus', () => {
  const today = new Date('2026-11-15T12:00:00Z');
  assert.equal(manualEntryProblem(30, '2026-11-15', today), null);
  assert.match(manualEntryProblem(0, '2026-11-15', today)!, /positiivinen/);
  assert.match(manualEntryProblem(1.5, '2026-11-15', today)!, /kokonaisluku/);
  assert.match(manualEntryProblem(25 * 60, '2026-11-15', today)!, /24 tuntia/);
  assert.match(manualEntryProblem(30, '15.11.2026', today)!, /VVVV/);
  assert.match(manualEntryProblem(30, '2026-11-16', today)!, /Tulevalle/);
});

test('yhteenveto: vuosi, kuukausi, ennuste ja tila', () => {
  const today = new Date('2026-11-15T12:00:00Z');
  const rows = [
    { companyId: 'a', day: d('2026-11-02'), minutes: 60 },
    { companyId: 'a', day: d('2026-07-01'), minutes: 120 }, // yli 90 pv sitten: ei ennusteessa
    { companyId: 'a', day: d('2025-10-01'), minutes: 600 }, // yli vuoden vanha: ei mukana
    { companyId: 'b', day: d('2026-11-10'), minutes: 540 },
  ];
  const [a, b, c] = summarize(['a', 'b', 'c'], rows, today, d('2026-06-01'));
  assert.equal(a.minutesYear, 180);
  assert.equal(a.minutesMonth, 60);
  assert.equal(a.projectedYearHours, 4.1);
  assert.equal(a.status, 'ok');
  // b: 9 h vuodessa (yli 80 % tavoitteesta) ja 90 päivän tahdilla 9 h / 90 pv => ennuste 36,5 h => yli
  assert.equal(b.projectedYearHours, 36.5);
  assert.equal(b.status, 'over');
  assert.equal(c.minutesYear, 0);
  assert.equal(c.status, 'ok');
  // Alle 30 päivän mittauksesta ei ennusteta
  const [early] = summarize(['a'], rows, today, d('2026-11-01'));
  assert.equal(early.projectedYearHours, null);
});
