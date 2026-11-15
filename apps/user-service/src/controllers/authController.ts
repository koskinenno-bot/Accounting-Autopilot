import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { ensureOrganization } from '../access';
const { authenticator } = require('otplib');
import QRCode from 'qrcode';

import { forgetTokenVersion } from '../middleware/auth';
import { LOCKED_MESSAGE, afterFailedLogin, isLocked, signToken } from '../session';

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, organizationName } = req.body;

    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Virheellinen sähköpostiosoite' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Salasanan on oltava vähintään 8 merkkiä' });
    }

    const existingUser = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
    if (existingUser) {
      return res.status(409).json({ error: 'Käyttäjä on jo olemassa' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        role: 'COMPANY_ADMIN',
        // Rekisteröityjä on isännöintitoimisto, josta hän on omistaja
        organizations: {
          create: {
            role: 'OWNER',
            organization: {
              create: {
                name: (typeof organizationName === 'string' && organizationName.trim())
                  || [firstName, lastName].filter(Boolean).join(' ') || email,
              },
            },
          },
        },
      },
    });

    const token = signToken(user);

    return res.status(201).json({ user: { id: user.id, email: user.email, role: user.role }, token });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Failed to register' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password, mfaToken } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Sähköposti ja salasana vaaditaan' });
    }

    const user = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Käyttäjää ei löydy tai väärä salasana' });
    }
    // Lukittu tunnus: salasanaa ei edes tarkisteta, jotta arvaaminen ei etene lukituksen aikana
    if (isLocked(user.lockedUntil)) {
      return res.status(429).json({ error: LOCKED_MESSAGE });
    }

    const failed = async (status: number, error: string) => {
      const next = afterFailedLogin(user.failedLogins);
      await prisma.user.update({ where: { id: user.id }, data: next });
      if (next.lockedUntil) return res.status(429).json({ error: LOCKED_MESSAGE });
      return res.status(status).json({ error });
    };

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return failed(401, 'Käyttäjää ei löydy tai väärä salasana');
    }

    // MFA Check
    if (user.mfaEnabled) {
      if (!mfaToken) {
        return res.json({ mfaRequired: true });
      }

      const isValid = authenticator.check(mfaToken, user.mfaSecret || '');
      if (!isValid) {
        return failed(401, 'Virheellinen MFA-koodi');
      }
    }

    if (user.failedLogins > 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }

    // Ennen toimistomallia luodut käyttäjät saavat toimiston ensimmäisellä kirjautumisella
    await ensureOrganization(user.id);

    const token = signToken(user);

    return res.json({ 
      user: { id: user.id, email: user.email, role: user.role, mfaEnabled: user.mfaEnabled }, 
      token 
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Kirjautuminen epäonnistui' });
  }
};

export const setupMFA = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user; // From auth middleware

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, 'AI Accountant v3', secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    // Save temporary secret (don't enable MFA yet)
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret }
    });

    return res.json({ qrCodeUrl, secret });
  } catch (error) {
    return res.status(500).json({ error: 'MFA setup failed' });
  }
};

export const verifyMFA = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user;
    const { token } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) return res.status(400).json({ error: 'MFA not initiated' });

    const isValid = authenticator.check(token, user.mfaSecret);
    if (!isValid) return res.status(400).json({ error: 'Virheellinen vahvistuskoodi' });

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true }
    });

    return res.json({ success: true, message: 'MFA aktivoitu onnistuneesti' });
  } catch (error) {
    return res.status(500).json({ error: 'MFA verification failed' });
  }
};

/** Kirjaa käyttäjän ulos kaikilta laitteilta: kaikki aiemmat tunnisteet lakkaavat toimimasta. */
export const logoutAll = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user;
    if (!userId || userId === 'service') return res.status(400).json({ error: 'Ei käyttäjää' });
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    forgetTokenVersion(userId);
    return res.json({ message: 'Kirjauduit ulos kaikilta laitteilta' });
  } catch (error) {
    console.error('Logout-all error:', error);
    return res.status(500).json({ error: 'Uloskirjautuminen epäonnistui' });
  }
};
