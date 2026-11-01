/**
 * Yhteinen tunnistautuminen kaikille Node-palveluille.
 *
 * TÄMÄ ON KANONINEN VERSIO. Sama tiedosto on kopioitu jokaiseen palveluun
 * polkuun src/middleware/requireAuth.ts (workspace-linkitys ei ole luotettava
 * kaikissa ympäristöissä). Jos muutat tätä, kopioi muutos palveluihin:
 *   node scripts/sync-auth.js
 *
 * Hyväksyy:
 *  1. Käyttäjän JWT:n:  Authorization: Bearer <token>  (user-service allekirjoittaa)
 *  2. Palveluiden välisen tunnisteen:  x-service-token: <SERVICE_TOKEN>
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  userId: string;
  role: string;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret';

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET puuttuu ympäristömuuttujista');
  }
  return DEV_FALLBACK_SECRET;
};

/** Otsakkeet palveluiden välisiin kutsuihin (axios: { headers: serviceHeaders() }). */
export const serviceHeaders = (): Record<string, string> => {
  const token = process.env.SERVICE_TOKEN;
  return token ? { 'x-service-token': token } : {};
};

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const serviceToken = process.env.SERVICE_TOKEN;
  const presented = req.headers['x-service-token'];
  if (serviceToken && typeof presented === 'string' && presented === serviceToken) {
    (req as AuthenticatedRequest).user = { userId: 'service', role: 'SERVICE' };
    return next();
  }

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: 'Tunnistautuminen vaaditaan' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as AuthUser;
    (req as AuthenticatedRequest).user = { userId: decoded.userId, role: decoded.role };
    return next();
  } catch {
    return res.status(401).json({ error: 'Virheellinen tai vanhentunut kirjautuminen' });
  }
};

// ---------------------------------------------------------------------------
// Yhtiökohtainen käyttöoikeus
//
// Kirjautuminen ei yksin riitä: käyttäjän on oltava yhtiön jäsen (user-servicen
// UserCompany), muuten kuka tahansa voisi lukea minkä tahansa yhtiön kirjanpidon
// tietämällä sen tunnuksen. Palvelukutsut (x-service-token) ja SUPER_ADMIN ohittavat.
// ---------------------------------------------------------------------------

const userServiceUrl = () => process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1';
const ACCESS_TTL_OK_MS = 60_000;
const ACCESS_TTL_DENIED_MS = 5_000; // lyhyt, jotta juuri luotu yhtiö näkyy heti
const accessCache = new Map<string, { ok: boolean; expires: number }>();

export const hasCompanyAccess = async (req: Request, companyId: unknown): Promise<boolean> => {
  const user = (req as AuthenticatedRequest).user;
  if (!user || typeof companyId !== 'string' || !companyId) return false;
  if (user.role === 'SERVICE' || user.role === 'SUPER_ADMIN') return true;

  const key = `${user.userId}:${companyId}`;
  const cached = accessCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.ok;

  // user-service tarkistaa jäsenyyden käyttäjän omalla tunnisteella
  let ok = false;
  try {
    const response = await fetch(`${userServiceUrl()}/companies/${encodeURIComponent(companyId)}/access`, {
      headers: { Authorization: req.headers.authorization || '' },
    });
    ok = response.ok;
  } catch (err: any) {
    // user-service alhaalla => evätään (fail closed), ei tallenneta välimuistiin
    console.error(`Käyttöoikeuden tarkistus epäonnistui: ${err.message}`);
    return false;
  }
  accessCache.set(key, { ok, expires: Date.now() + (ok ? ACCESS_TTL_OK_MS : ACCESS_TTL_DENIED_MS) });
  return ok;
};

/** Käsittelijöille, jotka selvittävät yhtiön vasta kannasta (esim. /entries/:id). Lähettää 403:n. */
export const assertCompanyAccess = async (req: Request, res: Response, companyId: unknown): Promise<boolean> => {
  if (await hasCompanyAccess(req, companyId)) return true;
  res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
  return false;
};

/**
 * Middleware: companyId luetaan querystä tai bodystä (multipart-reiteillä aseta multerin jälkeen).
 * required=true: puuttuva companyId => 400 (estää "kaikki yhtiöt" -listaukset).
 */
export const requireCompanyAccess = (options: { required?: boolean } = {}) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const companyId = (req.query?.companyId as string | undefined) ?? req.body?.companyId;
    if (!companyId) {
      if (options.required) return res.status(400).json({ error: 'companyId on pakollinen' });
      return next();
    }
    if (await assertCompanyAccess(req, res, companyId)) return next();
  };
