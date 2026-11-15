import { Request, Response } from 'express';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import {
  MAX_RESETS_PER_HOUR, RESET_TTL_MS, hashToken, isValidTokenFormat, maskEmail, newResetToken, passwordProblem, resetStatus,
} from '../passwordReset';
import { signToken } from '../session';
import { forgetTokenVersion } from '../middleware/auth';

const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008/api/v1';
const isProduction = process.env.NODE_ENV === 'production';

const GENERIC = 'Jos osoitteella on käyttäjätunnus, lähetimme siihen ohjeet salasanan vaihtamiseen. Linkki on voimassa tunnin.';
const STATUS_TEXT: Record<string, string> = {
  used: 'Linkki on jo käytetty. Pyydä tarvittaessa uusi linkki.',
  expired: 'Linkki on vanhentunut. Pyydä uusi linkki.',
  unknown: 'Linkki on virheellinen. Pyydä uusi linkki.',
};

const sendResetEmail = async (email: string, link: string) => {
  const body = [
    'Hei,',
    '',
    'joku (todennäköisesti sinä) pyysi AI Accountant -palvelun salasanan vaihtoa.',
    `Vaihda salasana tunnin kuluessa tästä linkistä: ${link}`,
    '',
    'Jos et pyytänyt vaihtoa, voit jättää viestin huomiotta. Salasanasi pysyy ennallaan.',
  ].join('\n');
  const token = process.env.SERVICE_TOKEN;
  await axios.post(`${NOTIFICATION_SERVICE_URL}/notify/email`, {
    companyId: 'system', recipient: email, subject: 'Salasanan vaihto', template: 'password-reset', data: { body },
  }, { headers: token ? { 'x-service-token': token } : {}, timeout: 10_000 });
};

/**
 * Palautuslinkin pyyntö. Vastaus on aina sama, ettei sillä voi selvittää, onko osoite rekisteröity.
 * Kehitysympäristössä linkki palautetaan myös vastauksessa (devLink), koska sähköposti ei vielä lähde.
 */
export const requestReset = async (req: Request, res: Response) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Virheellinen sähköpostiosoite' });
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    let devLink: string | undefined;
    if (user && user.isActive) {
      const recent = await prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
      if (recent < MAX_RESETS_PER_HOUR) {
        const { token, tokenHash } = newResetToken();
        await prisma.passwordReset.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
        const link = `${APP_URL}/reset-password/${token}`;
        sendResetEmail(user.email, link).catch((err) => console.error('Palautusviestin lähetys epäonnistui:', err?.message));
        if (!isProduction) {
          console.log(`[kehitys] Salasanan palautuslinkki ${user.email}: ${link}`);
          devLink = link;
        }
      }
    }
    return res.status(202).json({ message: GENERIC, ...(devLink ? { devLink } : {}) });
  } catch (error) {
    console.error('Password reset request error:', error);
    return res.status(500).json({ error: 'Pyyntö epäonnistui' });
  }
};

export const checkReset = async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!isValidTokenFormat(token)) return res.status(404).json({ status: 'unknown', error: STATUS_TEXT.unknown });
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  const status = resetStatus(row);
  if (status !== 'valid') return res.status(410).json({ status, error: STATUS_TEXT[status] });
  const user = await prisma.user.findUnique({ where: { id: row!.userId } });
  return res.json({ status, email: user ? maskEmail(user.email) : null });
};

export const confirmReset = async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body ?? {};
    if (!isValidTokenFormat(token)) return res.status(400).json({ error: STATUS_TEXT.unknown });
    const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
    const status = resetStatus(row);
    if (status !== 'valid') return res.status(410).json({ error: STATUS_TEXT[status] });
    const user = await prisma.user.findUnique({ where: { id: row!.userId } });
    if (!user || !user.isActive) return res.status(410).json({ error: STATUS_TEXT.unknown });
    const problem = passwordProblem(password, user.email);
    if (problem) return res.status(400).json({ error: problem });

    const passwordHash = await bcrypt.hash(password, 12);
    // Kertakäyttöisyys: linkki merkitään käytetyksi vain, jos se oli vielä käyttämättä (rinnakkaiset pyynnöt)
    const claimed = await prisma.$transaction(async (tx) => {
      const r = await tx.passwordReset.updateMany({ where: { id: row!.id, usedAt: null }, data: { usedAt: new Date() } });
      if (r.count !== 1) return false;
      // Vanhat kirjautumiset mitätöidään ja mahdollinen lukitus poistuu
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null } });
      // Muut avoimet linkit mitätöidään
      await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      return true;
    });
    if (!claimed) return res.status(410).json({ error: STATUS_TEXT.used });
    forgetTokenVersion(user.id);
    return res.json({ message: 'Salasana vaihdettu. Voit nyt kirjautua uudella salasanalla.' });
  } catch (error) {
    console.error('Password reset confirm error:', error);
    return res.status(500).json({ error: 'Salasanan vaihto epäonnistui' });
  }
};

/** Kirjautuneen käyttäjän salasanan vaihto (vaatii nykyisen salasanan). */
export const changePassword = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user;
    const { currentPassword, newPassword } = req.body ?? {};
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Käyttäjää ei löydy' });
    if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({ error: 'Nykyinen salasana on väärä' });
    }
    const problem = passwordProblem(newPassword, user.email);
    if (problem) return res.status(400).json({ error: problem });
    // Muut laitteet kirjataan ulos; tälle laitteelle palautetaan uusi tunniste
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), tokenVersion: { increment: 1 } },
    });
    forgetTokenVersion(user.id);
    return res.json({ message: 'Salasana vaihdettu. Muut laitteet kirjattiin ulos.', token: signToken(updated) });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Salasanan vaihto epäonnistui' });
  }
};
