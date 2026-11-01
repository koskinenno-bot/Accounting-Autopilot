import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '../../prisma/client';
const { authenticator } = require('otplib');
import QRCode from 'qrcode';

const prisma = new PrismaClient();
import { JWT_SECRET } from '../config';

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Virheellinen sähköpostiosoite' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Salasanan on oltava vähintään 8 merkkiä' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Käyttäjä on jo olemassa' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'COMPANY_ADMIN',
      },
    });

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: '24h',
    });

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

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Käyttäjää ei löydy tai väärä salasana' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Käyttäjää ei löydy tai väärä salasana' });
    }

    // MFA Check
    if (user.mfaEnabled) {
      if (!mfaToken) {
        return res.json({ mfaRequired: true });
      }

      const isValid = authenticator.check(mfaToken, user.mfaSecret || '');
      if (!isValid) {
        return res.status(401).json({ error: 'Virheellinen MFA-koodi' });
      }
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: '24h',
    });

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
