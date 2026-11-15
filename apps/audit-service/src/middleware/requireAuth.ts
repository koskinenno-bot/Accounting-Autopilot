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
// Kirjautuminen ei yksin riitä: käyttäjällä on oltava rooli yhtiössä (user-service:
// yhtiörooli tai isännöintitoimiston pääkäyttäjyys). Roolit:
//   MANAGER   isännöitsijä: kaikki, myös tilikauden sulkeminen ja avaussaldot
//   ASSISTANT kirjanpitoassistentti: kirjaukset, tositteet, laskut
//   BOARD     hallitus: vain luku
//   AUDITOR   tilin- tai toiminnantarkastaja: vain luku
// Palvelukutsut (x-service-token) ja SUPER_ADMIN ohittavat tarkistuksen.
// ---------------------------------------------------------------------------

/** read = katselu, write = kirjanpidon muutokset, manage = isännöitsijän päätökset. */
export type AccessLevel = 'read' | 'write' | 'manage';

const LEVEL_ROLES: Record<AccessLevel, string[]> = {
  read: ['MANAGER', 'ASSISTANT', 'BOARD', 'AUDITOR'],
  write: ['MANAGER', 'ASSISTANT'],
  manage: ['MANAGER'],
};

export const roleAllows = (role: string | null | undefined, level: AccessLevel): boolean =>
  Boolean(role) && LEVEL_ROLES[level].includes(role as string);

/** Oletustaso HTTP-metodista: lukevat metodit = read, muut = write. */
export const levelForMethod = (method: string | undefined): AccessLevel =>
  ['GET', 'HEAD', 'OPTIONS'].includes((method || 'GET').toUpperCase()) ? 'read' : 'write';

const userServiceUrl = () => process.env.USER_SERVICE_URL || 'http://localhost:3001/api/v1';
const ACCESS_TTL_OK_MS = 60_000;
const ACCESS_TTL_DENIED_MS = 5_000; // lyhyt, jotta juuri luotu yhtiö näkyy heti
const accessCache = new Map<string, { role: string | null; expires: number }>();

/** Käyttäjän rooli yhtiössä (null = ei pääsyä). */
export const getCompanyRole = async (req: Request, companyId: unknown): Promise<string | null> => {
  const user = (req as AuthenticatedRequest).user;
  if (!user || typeof companyId !== 'string' || !companyId) return null;
  if (user.role === 'SERVICE' || user.role === 'SUPER_ADMIN') return 'MANAGER';

  const key = `${user.userId}:${companyId}`;
  const cached = accessCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.role;

  // user-service tarkistaa roolin käyttäjän omalla tunnisteella
  let role: string | null = null;
  try {
    const response = await fetch(`${userServiceUrl()}/companies/${encodeURIComponent(companyId)}/access`, {
      headers: { Authorization: req.headers.authorization || '' },
    });
    if (response.ok) {
      // Vanha user-service vastasi 204 ilman roolia (ennen roolimallia = täydet oikeudet)
      const body: any = response.status === 204 ? null : await response.json().catch(() => null);
      role = typeof body?.role === 'string' ? body.role : 'MANAGER';
    }
  } catch (err: any) {
    // user-service alhaalla => evätään (fail closed), ei tallenneta välimuistiin
    console.error(`Käyttöoikeuden tarkistus epäonnistui: ${err.message}`);
    return null;
  }
  accessCache.set(key, { role, expires: Date.now() + (role ? ACCESS_TTL_OK_MS : ACCESS_TTL_DENIED_MS) });
  return role;
};

export const hasCompanyAccess = async (req: Request, companyId: unknown, level?: AccessLevel): Promise<boolean> =>
  roleAllows(await getCompanyRole(req, companyId), level ?? levelForMethod(req.method));

/**
 * Käsittelijöille, jotka selvittävät yhtiön vasta kannasta (esim. /entries/:id). Lähettää 403:n.
 * level puuttuu => päätellään HTTP-metodista.
 */
export const assertCompanyAccess = async (
  req: Request, res: Response, companyId: unknown, level?: AccessLevel,
): Promise<boolean> => {
  const needed = level ?? levelForMethod(req.method);
  const role = await getCompanyRole(req, companyId);
  if (roleAllows(role, needed)) {
    (req as any).companyRole = role;
    return true;
  }
  if (!role) res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
  else if (needed === 'manage') res.status(403).json({ error: 'Vain isännöitsijä voi tehdä tämän toiminnon' });
  else res.status(403).json({ error: 'Sinulla on tähän yhtiöön vain lukuoikeus' });
  return false;
};

/**
 * Middleware: companyId luetaan querystä tai bodystä (multipart-reiteillä aseta multerin jälkeen).
 * required=true: puuttuva companyId => 400 (estää "kaikki yhtiöt" -listaukset).
 * level: oletuksena HTTP-metodista (GET = read, muut = write).
 */
export const requireCompanyAccess = (options: { required?: boolean; level?: AccessLevel } = {}) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const companyId = (req.query?.companyId as string | undefined) ?? req.body?.companyId;
    if (!companyId) {
      if (options.required) return res.status(400).json({ error: 'companyId on pakollinen' });
      return next();
    }
    if (await assertCompanyAccess(req, res, companyId, options.level)) return next();
  };
