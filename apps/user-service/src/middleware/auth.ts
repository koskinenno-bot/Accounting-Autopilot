import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '../config';
import { prisma } from '../db';
import { tokenVersionValid } from '../session';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

// Tunnisteen version tarkistus: lyhyt välimuisti, jotta jokainen pyyntö ei mene kantaan
const VERSION_TTL_MS = 10_000;
const versionCache = new Map<string, { tv: number; active: boolean; expires: number }>();

const currentVersion = async (userId: string) => {
  const cached = versionCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true, isActive: true } });
  const entry = { tv: user?.tokenVersion ?? -1, active: Boolean(user?.isActive), expires: Date.now() + VERSION_TTL_MS };
  versionCache.set(userId, entry);
  return entry;
};

/** Kutsutaan, kun käyttäjän tokenVersion muuttuu (sama prosessi näkee muutoksen heti). */
export const forgetTokenVersion = (userId: string) => { versionCache.delete(userId); };

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Palveluiden väliset kutsut (esim. invoicing-service) tunnistetaan jaetulla tunnisteella.
  const serviceToken = process.env.SERVICE_TOKEN;
  const presented = req.headers['x-service-token'];
  if (serviceToken && typeof presented === 'string' && presented === serviceToken) {
    req.user = { userId: 'service', role: 'SERVICE' };
    return next();
  }

  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let decoded: { userId: string; role: string; tv?: number };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string; tv?: number };
  } catch (error) {
    return res.status(401).json({ error: 'Virheellinen tai vanhentunut kirjautuminen' });
  }
  try {
    // Salasanan vaihto, uloskirjautuminen kaikkialta tai poistettu käyttäjä mitätöi tunnisteen
    const current = await currentVersion(decoded.userId);
    if (!current.active || !tokenVersionValid(decoded.tv, current.tv)) {
      return res.status(401).json({ error: 'Kirjautuminen on vanhentunut. Kirjaudu uudelleen.' });
    }
  } catch (error: any) {
    console.error('Tunnisteen tarkistus epäonnistui:', error?.message);
    return res.status(503).json({ error: 'Palvelu ei juuri nyt vastaa' });
  }
  req.user = { userId: decoded.userId, role: decoded.role };
  next();
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};
