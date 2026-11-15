import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { JWT_SECRET } from '../config';
import { COMPANY_ROLE_LABELS, CompanyRole, isCompanyRole } from '../access';

/** Kutsun voimassaolo; palauttaa kutsun tai lähettää virheen. */
const loadOpenInvitation = async (token: string, res: Response) => {
  const invitation = await prisma.invitation.findUnique({ where: { token }, include: { organization: true } });
  if (!invitation) {
    res.status(404).json({ error: 'Kutsua ei löydy' });
    return null;
  }
  if (invitation.acceptedAt) {
    res.status(410).json({ error: 'Kutsu on jo käytetty. Kirjaudu sisään.' });
    return null;
  }
  if (invitation.expiresAt < new Date()) {
    res.status(410).json({ error: 'Kutsu on vanhentunut. Pyydä uusi kutsu isännöitsijältä.' });
    return null;
  }
  return invitation;
};

const companyRolesOf = (invitation: { companyRoles: unknown }) =>
  (Array.isArray(invitation.companyRoles) ? invitation.companyRoles : []) as { companyId: string; role: string }[];

/** Julkinen: kutsun tiedot hyväksymissivulle. */
export const getInvitation = async (req: Request, res: Response) => {
  try {
    const invitation = await loadOpenInvitation(req.params.token, res);
    if (!invitation) return;
    const roles = companyRolesOf(invitation);
    const companies = await prisma.company.findMany({ where: { id: { in: roles.map((r) => r.companyId) } } });
    const userExists = Boolean(await prisma.user.findFirst({ where: { email: { equals: invitation.email, mode: 'insensitive' } } }));
    res.json({
      email: invitation.email,
      organizationName: invitation.organization.name,
      orgRole: invitation.orgRole,
      companies: roles.map((r) => ({
        name: companies.find((c) => c.id === r.companyId)?.name ?? '(poistettu yhtiö)',
        role: r.role,
        roleLabel: isCompanyRole(r.role) ? COMPANY_ROLE_LABELS[r.role as CompanyRole] : r.role,
      })),
      expiresAt: invitation.expiresAt,
      userExists,
    });
  } catch (error) {
    console.error('Invitation error:', error);
    res.status(500).json({ error: 'Kutsun haku epäonnistui' });
  }
};

/**
 * Julkinen: kutsun hyväksyntä. Uusi käyttäjä asettaa salasanan; olemassa oleva vahvistaa omalla salasanallaan.
 * Palauttaa kirjautumistunnisteen kuten /auth/login.
 */
export const acceptInvitation = async (req: Request, res: Response) => {
  try {
    const invitation = await loadOpenInvitation(req.params.token, res);
    if (!invitation) return;
    const { password, firstName, lastName } = req.body;
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Salasanan on oltava vähintään 8 merkkiä' });
    }

    let user = await prisma.user.findFirst({ where: { email: { equals: invitation.email, mode: 'insensitive' } } });
    if (user) {
      if (!user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: 'Väärä salasana. Käytä nykyistä salasanaasi.' });
      }
      if (user.mfaEnabled) {
        // MFA-käyttäjä hyväksyy kutsun kirjautumalla normaalisti ensin (ei ohiteta toista tekijää).
        const { mfaToken } = req.body;
        const { authenticator } = require('otplib');
        if (!mfaToken) return res.json({ mfaRequired: true });
        if (!authenticator.check(mfaToken, user.mfaSecret || '')) return res.status(401).json({ error: 'Virheellinen MFA-koodi' });
      }
    }

    // Vain kutsuhetkellä toimistoon yhä kuuluvat yhtiöt
    const roles = companyRolesOf(invitation);
    const stillInOrg = new Set(
      (await prisma.company.findMany({
        where: { id: { in: roles.map((r) => r.companyId) }, organizationId: invitation.organizationId },
        select: { id: true },
      })).map((c) => c.id),
    );

    const userId = await prisma.$transaction(async (tx) => {
      const u = user ?? await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash: await bcrypt.hash(password, 12),
          firstName: typeof firstName === 'string' ? firstName : undefined,
          lastName: typeof lastName === 'string' ? lastName : undefined,
          role: 'USER',
        },
      });
      if (invitation.orgRole) {
        await tx.organizationMember.upsert({
          where: { userId_organizationId: { userId: u.id, organizationId: invitation.organizationId } },
          create: { userId: u.id, organizationId: invitation.organizationId, role: invitation.orgRole },
          update: {}, // olemassa olevaa toimistoroolia ei alenneta kutsulla
        });
      }
      for (const r of roles) {
        if (!stillInOrg.has(r.companyId)) continue;
        await tx.userCompany.upsert({
          where: { userId_companyId: { userId: u.id, companyId: r.companyId } },
          create: { userId: u.id, companyId: r.companyId, role: r.role },
          update: { role: r.role },
        });
      }
      await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      return u.id;
    });

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = jwt.sign({ userId: fresh.id, role: fresh.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ user: { id: fresh.id, email: fresh.email, role: fresh.role, mfaEnabled: fresh.mfaEnabled }, token });
  } catch (error) {
    console.error('Invitation accept error:', error);
    res.status(500).json({ error: 'Kutsun hyväksyntä epäonnistui' });
  }
};
