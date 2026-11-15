import crypto from 'crypto';

/**
 * Salasanan palautuksen apufunktiot (puhtaat, testattavissa).
 * Tunniste on 32 satunnaistavua base64url-muodossa; kantaan tallennetaan vain sen SHA-256-tiiviste,
 * joten vuotanut tietokanta ei paljasta voimassa olevia linkkejä.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;      // linkki voimassa tunnin
export const MAX_RESETS_PER_HOUR = 3;            // estää sähköpostipommituksen
export const MIN_PASSWORD_LENGTH = 8;

export const newResetToken = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
};

export const hashToken = (token: string) => crypto.createHash('sha256').update(String(token)).digest('hex');

export const isValidTokenFormat = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

/** Salasanan vähimmäisvaatimus: 8 merkkiä, ei pelkkiä samoja merkkejä, ei sähköpostiosoite. */
export const passwordProblem = (password: unknown, email?: string): string | null => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `Salasanan on oltava vähintään ${MIN_PASSWORD_LENGTH} merkkiä`;
  if (password.length > 200) return 'Salasana on liian pitkä';
  if (/^(.)\1+$/.test(password)) return 'Salasana ei voi olla samaa merkkiä toistettuna';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Salasana ei voi olla sähköpostiosoite';
  return null;
};

/** a***@toimisto.fi: näytetään palautussivulla, ettei koko osoite paljastu linkin haltijalle. */
export const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, user.length - 1))}@${domain}`;
};

export type ResetStatus = 'valid' | 'used' | 'expired' | 'unknown';
export const resetStatus = (row: { expiresAt: Date; usedAt: Date | null } | null, now = new Date()): ResetStatus => {
  if (!row) return 'unknown';
  if (row.usedAt) return 'used';
  if (row.expiresAt <= now) return 'expired';
  return 'valid';
};
