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
