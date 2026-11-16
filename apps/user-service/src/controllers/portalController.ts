import { Request, Response } from 'express';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { canWrite, dashboardUrl, getCompanyRole } from '../access';
import { signToken } from '../session';

/**
 * Osakasportaali: isännöitsijä kutsuu osakkaat (osakasluettelon sähköpostit), osakas luo tunnuksen ja näkee
 * omien huoneistojensa vastikelaskut ja maksutiedot (invoicing-service GET /invoices/portal).
 *
 * Osakas ei saa yhtiöroolia: hänellä ei ole pääsyä kirjanpitoon, raportteihin eikä muiden huoneistojen tietoihin.
 * Yhteys huoneistoihin kulkee Shareholder.userId-kentän kautta (säilyy osakasluettelon uudelleentuonnissa
 * sähköpostin perusteella).
 */

const DAY = 86_400_000;
export const PORTAL_INVITATION_DAYS = 30;
export const PORTAL_ROLE = 'SHAREHOLDER';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008/api/v1';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const portalLink = (token: string) => `${dashboardUrl()}/portal/invite/${token}`;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const handle = (fn: (req: AuthRequest, res: Response) => Promise<any>) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Osakasportaalin virhe:', err);
    res.status(500).json({ error: 'Toiminto epäonnistui' });
  }
};

/** Huoneistonumerot osakkaan osakkeista ("A 1, A 2"). */
const apartmentsText = (shares: { apartment: unknown }[]) =>
  [...new Set(shares.map((s) => String((s.apartment as any)?.number ?? '').trim()).filter(Boolean))].join(', ');

const requireWriter = async (req: AuthRequest, companyId: string) => {
  if (!req.user) throw new HttpError(401, 'Tunnistautuminen vaaditaan');
  if (typeof companyId !== 'string' || !companyId) throw new HttpError(400, 'companyId puuttuu');
  const role = await getCompanyRole(req.user, companyId);
  if (!canWrite(role)) throw new HttpError(403, 'Kutsut lähettää isännöitsijä tai kirjanpitoassistentti');
};

/** GET /shareholders/portal-status?companyId : osakkaiden portaalitila (käytössä, kutsuttu, ei kutsuttu). */
export const portalStatus = handle(async (req, res) => {
  const companyId = String(req.query.companyId ?? '');
  await requireWriter(req, companyId);
  const [shareholders, invitations] = await Promise.all([
    prisma.shareholder.findMany({ where: { companyId }, include: { shares: true } }),
    prisma.portalInvitation.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const byEmail = new Map<string, { email: string; name: string; apartments: Set<string>; linked: boolean }>();
  for (const s of shareholders) {
    const email = s.email.trim().toLowerCase();
    if (!EMAIL.test(email)) continue;
    const row = byEmail.get(email) ?? { email, name: s.companyName || [s.firstName, s.lastName].filter(Boolean).join(' '), apartments: new Set(), linked: false };
    for (const a of apartmentsText(s.shares).split(', ').filter(Boolean)) row.apartments.add(a);
    row.linked = row.linked || Boolean(s.userId);
    byEmail.set(email, row);
  }
  const noEmail = shareholders.filter((s) => !EMAIL.test(s.email.trim())).length;
  res.json({
    noEmail,
    shareholders: [...byEmail.values()].map((r) => {
      const inv = invitations.find((i) => i.email === r.email);
      return {
        email: r.email, name: r.name, apartments: [...r.apartments].join(', '),
        status: r.linked ? 'ACTIVE' : inv && !inv.acceptedAt && inv.expiresAt > new Date() ? 'INVITED' : inv && !inv.acceptedAt ? 'EXPIRED' : 'NONE',
        invitedAt: inv?.createdAt ?? null,
      };
    }).sort((a, b) => a.apartments.localeCompare(b.apartments, 'fi', { numeric: true })),
  });
});

/**
 * POST /shareholders/portal-invitations { companyId, emails? } : kutsut osakkaille (oletus: kaikki, joilla ei vielä
 * ole portaalia). Viesti lähtee sähköpostilla; kehitysympäristössä linkit palautetaan myös vastauksessa.
 */
export const sendPortalInvitations = handle(async (req, res) => {
  const { companyId, emails } = req.body ?? {};
  await requireWriter(req, companyId);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  if (!company) throw new HttpError(404, 'Yhtiötä ei löydy');
  const wanted = Array.isArray(emails) ? new Set(emails.map((e: unknown) => String(e).trim().toLowerCase())) : null;
  const shareholders = await prisma.shareholder.findMany({ where: { companyId }, include: { shares: true } });
  const targets = new Map<string, { apartments: string[]; linked: boolean }>();
  for (const s of shareholders) {
    const email = s.email.trim().toLowerCase();
    if (!EMAIL.test(email) || (wanted && !wanted.has(email))) continue;
    const t = targets.get(email) ?? { apartments: [], linked: false };
    t.apartments.push(...apartmentsText(s.shares).split(', ').filter(Boolean));
    t.linked = t.linked || Boolean(s.userId);
    targets.set(email, t);
  }
  const inviter = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { firstName: true, lastName: true, email: true } });
  const inviterName = [inviter?.firstName, inviter?.lastName].filter(Boolean).join(' ') || inviter?.email || 'Isännöitsijä';
  const sent: string[] = [];
  const skipped: { email: string; reason: string }[] = [];
  const links: { email: string; link: string }[] = [];
  for (const [email, t] of targets) {
    if (t.linked && !wanted) { skipped.push({ email, reason: 'Portaali on jo käytössä' }); continue; }
    const token = randomBytes(24).toString('base64url');
    await prisma.portalInvitation.deleteMany({ where: { companyId, email, acceptedAt: null } });
    await prisma.portalInvitation.create({
      data: { companyId, email, tokenHash: hash(token), invitedBy: req.user!.userId, expiresAt: new Date(Date.now() + PORTAL_INVITATION_DAYS * DAY) },
    });
    const link = portalLink(token);
    const apartments = [...new Set(t.apartments)].join(', ');
    try {
      const serviceToken = process.env.SERVICE_TOKEN;
      await axios.post(`${NOTIFICATION_SERVICE_URL}/notify/email`, {
        companyId, recipient: email, subject: `${company.name}: osakasportaali`, template: 'portal-invitation',
        data: { companyName: company.name, apartments, link, days: PORTAL_INVITATION_DAYS, inviterName },
      }, { headers: serviceToken ? { 'x-service-token': serviceToken } : {}, timeout: 15_000 });
      sent.push(email);
    } catch (err: any) {
      skipped.push({ email, reason: `Sähköpostin lähetys epäonnistui: ${err?.response?.data?.error || err?.message}` });
    }
    if (process.env.NODE_ENV !== 'production') links.push({ email, link });
  }
  if (!targets.size) throw new HttpError(400, 'Osakasluettelossa ei ole sähköpostiosoitteita');
  res.status(201).json({ sent: sent.length, skipped, ...(links.length ? { devLinks: links } : {}) });
});

const loadInvitation = async (token: string) => {
  const inv = await prisma.portalInvitation.findUnique({ where: { tokenHash: hash(String(token)) } });
  if (!inv) throw new HttpError(404, 'Kutsua ei löydy');
  if (inv.acceptedAt) throw new HttpError(410, 'Kutsu on jo käytetty. Kirjaudu sisään.');
  if (inv.expiresAt < new Date()) throw new HttpError(410, 'Kutsu on vanhentunut. Pyydä uusi kutsu isännöitsijältä.');
  return inv;
};

/** Julkinen: GET /portal/invitations/:token */
export const getPortalInvitation = handle(async (req: Request, res) => {
  const inv = await loadInvitation(req.params.token);
  const [company, shareholders, user] = await Promise.all([
    prisma.company.findUnique({ where: { id: inv.companyId }, select: { name: true } }),
    prisma.shareholder.findMany({ where: { companyId: inv.companyId, email: { equals: inv.email, mode: 'insensitive' } }, include: { shares: true } }),
    prisma.user.findFirst({ where: { email: { equals: inv.email, mode: 'insensitive' } }, select: { id: true } }),
  ]);
  res.json({ email: inv.email, companyName: company?.name ?? '', apartments: apartmentsText(shareholders.flatMap((s) => s.shares)), userExists: Boolean(user), expiresAt: inv.expiresAt });
});

/**
 * Julkinen: POST /portal/invitations/:token/accept { password, firstName?, lastName? }
 * Uusi käyttäjä luodaan roolilla SHAREHOLDER (ei toimistoa, ei yhtiörooleja). Olemassa oleva käyttäjä vahvistaa
 * omalla salasanallaan. Osakasluettelon saman sähköpostin rivit liitetään käyttäjään.
 */
export const acceptPortalInvitation = handle(async (req: Request, res) => {
  const inv = await loadInvitation(req.params.token);
  const { password, firstName, lastName } = req.body ?? {};
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Salasanan on oltava vähintään 8 merkkiä');
  let user = await prisma.user.findFirst({ where: { email: { equals: inv.email, mode: 'insensitive' } } });
  if (user) {
    if (!user.isActive || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'Väärä salasana. Käytä nykyistä salasanaasi.');
    if (user.mfaEnabled) throw new HttpError(409, 'Tunnuksellasi on kaksivaiheinen tunnistautuminen: kirjaudu sisään ja avaa kutsulinkki uudelleen.');
  } else {
    user = await prisma.user.create({
      data: {
        email: inv.email, passwordHash: await bcrypt.hash(password, 12), role: PORTAL_ROLE,
        firstName: typeof firstName === 'string' ? firstName.trim() || null : null,
        lastName: typeof lastName === 'string' ? lastName.trim() || null : null,
      },
    });
  }
  await prisma.$transaction([
    prisma.shareholder.updateMany({ where: { companyId: inv.companyId, email: { equals: inv.email, mode: 'insensitive' } }, data: { userId: user.id } }),
    prisma.portalInvitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
  ]);
  res.json({ user: { id: user.id, email: user.email, role: user.role }, token: signToken(user) });
});

/**
 * GET /portal/me : kirjautuneen osakkaan yhtiöt ja huoneistot (omistuksen alku ja loppu) sekä yhtiön maksutiedot.
 * Myös invoicing-service käyttää tätä rajatakseen laskut (käyttäjän omalla tunnisteella).
 */
export const getPortalMe = handle(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Tunnistautuminen vaaditaan');
  const shareholders = await prisma.shareholder.findMany({
    where: { userId: req.user.userId },
    include: { shares: true, company: { select: { id: true, name: true, businessId: true, settings: true } } },
  });
  const companies = new Map<string, any>();
  for (const s of shareholders) {
    const settings = (s.company.settings as Record<string, unknown> | null) ?? {};
    const c = companies.get(s.companyId) ?? {
      companyId: s.companyId, companyName: s.company.name, businessId: s.company.businessId,
      iban: typeof settings.iban === 'string' ? settings.iban : null, bic: typeof settings.bic === 'string' ? settings.bic : null,
      apartments: [] as any[],
    };
    for (const share of s.shares) {
      const ap = (share.apartment as any) ?? {};
      if (!ap.number) continue;
      c.apartments.push({
        apartment: String(ap.number).trim(), squareMeters: Number(ap.squareMeters) || null, shareNumbers: share.shareNumbers,
        ownershipStart: share.ownershipStart, ownershipEnd: share.ownershipEnd,
      });
    }
    companies.set(s.companyId, c);
  }
  // Huoneiston nykyiset omistajat (sähköpostit): laskut rajataan niihin, jotka on osoitettu jollekulle heistä.
  // Näin huoneiston edellisen omistajan laskut eivät näy uudelle omistajalle.
  const coOwners = await prisma.shareholder.findMany({ where: { companyId: { in: [...companies.keys()] } }, include: { shares: true } });
  const now = new Date();
  for (const c of companies.values()) {
    for (const a of c.apartments) {
      a.ownerEmails = [...new Set(coOwners.filter((s) => s.companyId === c.companyId && s.shares.some((sh) =>
        String((sh.apartment as any)?.number ?? '').trim() === a.apartment && (!sh.ownershipEnd || sh.ownershipEnd > now)))
        .map((s) => s.email.trim().toLowerCase()))];
    }
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { email: true, firstName: true, lastName: true } });
  res.json({ user, companies: [...companies.values()] });
});
