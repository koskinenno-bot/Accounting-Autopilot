import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config';

/**
 * Kirjautumistunnisteet ja kirjautumisyritysten rajoitus.
 *
 * Tunnisteeseen kirjataan käyttäjän tokenVersion (tv). Kun salasana vaihdetaan tai käyttäjä
 * kirjautuu ulos kaikkialta, versio kasvaa ja vanhat tunnisteet hylätään (user-service
 * tarkistaa version jokaisessa pyynnössä; muut palvelut tarkistavat yhtiöoikeuden user-serviceltä,
 * joten vanha tunniste lakkaa toimimasta niissäkin viimeistään minuutissa).
 */
export const TOKEN_TTL = '12h';
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export interface TokenUser { id: string; role: string; tokenVersion?: number | null }

export const signToken = (user: TokenUser): string =>
  jwt.sign({ userId: user.id, role: user.role, tv: user.tokenVersion ?? 0 }, JWT_SECRET, { expiresIn: TOKEN_TTL });

/** Onko tunnisteen versio yhä voimassa (tunnisteet ilman versiota = versio 0). */
export const tokenVersionValid = (tokenTv: unknown, userTv: number): boolean =>
  (typeof tokenTv === 'number' ? tokenTv : 0) === userTv;

/** Tunnus lukittuna tällä hetkellä? */
export const isLocked = (lockedUntil: Date | null | undefined, now = new Date()): boolean =>
  Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());

/** Epäonnistuneen yrityksen jälkeinen tila: viidennestä peräkkäisestä virheestä lukitus 15 minuutiksi. */
export const afterFailedLogin = (failedLogins: number, now = new Date()): { failedLogins: number; lockedUntil: Date | null } => {
  const count = failedLogins + 1;
  if (count >= MAX_FAILED_LOGINS) {
    return { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) };
  }
  return { failedLogins: count, lockedUntil: null };
};

export const LOCKED_MESSAGE = `Liian monta epäonnistunutta kirjautumista. Yritä uudelleen ${LOCK_MINUTES} minuutin kuluttua tai vaihda salasana.`;
