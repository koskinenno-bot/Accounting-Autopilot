/**
 * Paikallinen tapahtumaväylä yhden prosessin tilaan (apps/server, EVENT_BUS=local).
 *
 * TÄMÄ ON KANONINEN VERSIO. Kopio palveluihin polkuun src/utils/localBus.ts: node scripts/sync-auth.js
 *
 * Erillisinä palveluina tapahtumat kulkevat Kafkan kautta. Kun kaikki palvelut ajetaan samassa
 * prosessissa, Kafkaa ei tarvita: julkaisu kutsuu tilaajia suoraan. Tilaajat ajetaan järjestyksessä ja
 * julkaisu odottaa ne, joten virhe näkyy julkaisijalle (esim. pankkihaku ei siirrä hakukohtaa eteenpäin).
 * Väylä on globaali, koska jokaisella palvelulla on tästä tiedostosta oma kopio.
 */
type Handler = (payload: any) => Promise<void> | void;

const g = globalThis as any;
const handlers: Map<string, { name: string; fn: Handler }[]> = g.__aiAccountantLocalBus ??= new Map();

export const localBusEnabled = (): boolean => process.env.EVENT_BUS === 'local';

export const subscribeLocal = (topic: string, name: string, fn: Handler) => {
  const list = handlers.get(topic) ?? [];
  if (!list.some((h) => h.name === name)) list.push({ name, fn });
  handlers.set(topic, list);
};

const RETRY_DELAYS_MS = [500, 2000];

/** Julkaisee tapahtuman. Viesti kulkee JSON-muodossa kuten Kafkassa (päivämäärät merkkijonoina). */
export const publishLocal = async (topic: string, payload: unknown): Promise<void> => {
  const list = handlers.get(topic) ?? [];
  if (list.length === 0) {
    console.warn(`Tapahtumalla ${topic} ei ole tilaajia`);
    return;
  }
  const json = JSON.stringify(payload);
  const failures: string[] = [];
  for (const h of list) {
    for (let attempt = 0; ; attempt++) {
      try {
        await h.fn(JSON.parse(json));
        break;
      } catch (err: any) {
        if (attempt >= RETRY_DELAYS_MS.length) {
          console.error(`Tapahtuman ${topic} käsittely epäonnistui (${h.name}):`, err?.message || err);
          failures.push(`${h.name}: ${err?.message || err}`);
          break;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  if (failures.length) throw new Error(`Tapahtuman ${topic} käsittely epäonnistui: ${failures.join('; ')}`);
};
