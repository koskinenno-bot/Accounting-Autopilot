/**
 * Ajankäyttö yhtiöittäin.
 *
 * Tuotteen lupaus isännöitsijälle on, että yhtiön kirjanpitoon kuluu ihmistyötä alle 10 tuntia vuodessa.
 * Aika mitataan automaattisesti (dashboard lähettää merkin minuutin välein, kun käyttäjä on aktiivinen
 * yhtiön sivuilla) ja sitä voi täydentää käsin työstä, joka tehdään ohjelman ulkopuolella.
 */

/** Vuositavoite tunteina (yhtiötä kohden). */
export const targetHours = (): number => {
  const v = Number(process.env.TIME_TARGET_HOURS);
  return Number.isFinite(v) && v > 0 ? v : 10;
};

/** Merkkien väli on minuutti; lähempänä edellistä saapuva merkki (esim. toinen välilehti) ei kasvata aikaa. */
export const MIN_BEAT_INTERVAL_MS = 50_000;

export const beatCounts = (lastBeat: Date | null | undefined, now: Date): boolean =>
  !lastBeat || now.getTime() - lastBeat.getTime() >= MIN_BEAT_INTERVAL_MS;

/** Päivä UTC-keskiyönä (Prisman @db.Date). Suomen aika: päivä vaihtuu paikallisen kellon mukaan. */
export const dayOf = (d: Date, timeZone = 'Europe/Helsinki'): Date => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return new Date(`${parts}T00:00:00.000Z`);
};

export const MAX_MANUAL_MINUTES = 24 * 60;

/** Käsin kirjattavan ajan tarkistus. Palauttaa virheen tai null. */
export const manualEntryProblem = (minutes: unknown, day: unknown, today: Date): string | null => {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0) return 'Minuuttien on oltava positiivinen kokonaisluku';
  if (minutes > MAX_MANUAL_MINUTES) return 'Yhdelle päivälle voi kirjata enintään 24 tuntia';
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return 'Päivä muodossa VVVV-KK-PP';
  if (new Date(`${day}T00:00:00Z`) > dayOf(today)) return 'Tulevalle päivälle ei voi kirjata aikaa';
  return null;
};

export interface TimeRow { companyId: string; day: Date; minutes: number }

export interface CompanyTime {
  companyId: string;
  /** Viimeiset 12 kuukautta (365 päivää). */
  minutesYear: number;
  /** Kuluva kalenterikuukausi. */
  minutesMonth: number;
  /** Arvio koko vuodelle viimeisen 90 päivän tahdilla (null, jos dataa < 30 päivää). */
  projectedYearHours: number | null;
  targetHours: number;
  status: 'ok' | 'warning' | 'over';
}

/** Yhteenveto yhtiöittäin. rows = automaattiset ja käsin kirjatut yhdessä. firstDay = mittauksen alku. */
export const summarize = (companyIds: string[], rows: TimeRow[], today: Date, firstDay?: Date | null): CompanyTime[] => {
  const t = dayOf(today).getTime();
  const DAY = 86_400_000;
  const yearStart = t - 364 * DAY;
  const q90 = t - 89 * DAY;
  const monthStart = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1);
  const target = targetHours();
  const measuredDays = firstDay ? Math.floor((t - dayOf(firstDay).getTime()) / DAY) + 1 : 0;

  return companyIds.map((companyId) => {
    let year = 0; let month = 0; let last90 = 0;
    for (const r of rows) {
      if (r.companyId !== companyId) continue;
      const d = r.day.getTime();
      if (d > t) continue;
      if (d >= yearStart) year += r.minutes;
      if (d >= monthStart) month += r.minutes;
      if (d >= q90) last90 += r.minutes;
    }
    const window = Math.min(90, measuredDays);
    const projectedYearHours = window >= 30 ? Math.round((last90 / window) * 365 / 6) / 10 : null;
    const yearHours = year / 60;
    const basis = Math.max(yearHours, projectedYearHours ?? 0);
    const status = basis > target ? 'over' : basis > target * 0.8 ? 'warning' : 'ok';
    return { companyId, minutesYear: year, minutesMonth: month, projectedYearHours, targetHours: target, status };
  });
};
