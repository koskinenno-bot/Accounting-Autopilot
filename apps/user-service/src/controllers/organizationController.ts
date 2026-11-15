import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import {
  INVITATION_TTL_DAYS, dashboardUrl, ensureOrganization, getOrgRole, isOrgAdmin, newInvitationToken,
  validateAssignment, wouldRemoveLastOwner,
} from '../access';

const DAY = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const handle = (fn: (req: AuthRequest, res: Response) => Promise<any>) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Organization error:', err);
    res.status(500).json({ error: 'Toiminto epäonnistui' });
  }
};

/** Toimiston omistaja tai pääkäyttäjä (SUPER_ADMIN ohittaa). */
const requireOrgAdmin = async (req: AuthRequest, organizationId: string) => {
  if (!req.user) throw new HttpError(401, 'Tunnistautuminen vaaditaan');
  if (req.user.role === 'SUPER_ADMIN') return;
  const role = await getOrgRole(req.user.userId, organizationId);
  if (!isOrgAdmin(role)) throw new HttpError(403, 'Vain toimiston omistaja tai pääkäyttäjä voi hallita käyttäjiä');
};

const orgCompanyIds = async (organizationId: string) =>
  new Set((await prisma.company.findMany({ where: { organizationId }, select: { id: true } })).map((c) => c.id));

const invitationLink = (token: string) => `${dashboardUrl()}/invite/${token}`;

/** Kirjautuneen käyttäjän toimisto ja rooli. Ulkopuolisella (hallitus, tarkastaja) ei ole toimistoa. */
export const getMyOrganization = handle(async (req, res) => {
  if (!req.user) throw new HttpError(401, 'Tunnistautuminen vaaditaan');
  await ensureOrganization(req.user.userId);
  const member = await prisma.organizationMember.findFirst({
    where: { userId: req.user.userId },
    include: { organization: { include: { _count: { select: { companies: true, members: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!member) return res.json({ organization: null, role: null });
  const { _count, ...organization } = member.organization;
  res.json({ organization: { ...organization, companyCount: _count.companies, memberCount: _count.members }, role: member.role });
});

export const updateOrganization = handle(async (req, res) => {
  await requireOrgAdmin(req, req.params.id);
  const { name, businessId } = req.body;
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) throw new HttpError(400, 'Nimi puuttuu');
  const org = await prisma.organization.update({
    where: { id: req.params.id },
    data: { ...(name ? { name: name.trim() } : {}), ...(businessId !== undefined ? { businessId: businessId || null } : {}) },
  });
  res.json(org);
});

/**
 * Toimiston käyttäjät: jäsenet (toimistorooli) ja ulkopuoliset, joilla on rooli jossain toimiston yhtiössä.
 */
export const listUsers = handle(async (req, res) => {
  const organizationId = req.params.id;
  await requireOrgAdmin(req, organizationId);
  const companyIds = [...(await orgCompanyIds(organizationId))];
  const [members, companyRoles] = await Promise.all([
    prisma.organizationMember.findMany({ where: { organizationId }, include: { user: true } }),
    prisma.userCompany.findMany({ where: { companyId: { in: companyIds } }, include: { user: true, company: true } }),
  ]);

  const users = new Map<string, any>();
  const entry = (u: { id: string; email: string; firstName: string | null; lastName: string | null; isActive: boolean }) => {
    if (!users.has(u.id)) {
      users.set(u.id, {
        id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, isActive: u.isActive,
        orgRole: null, companyRoles: [],
      });
    }
    return users.get(u.id);
  };
  for (const m of members) entry(m.user).orgRole = m.role;
  for (const uc of companyRoles) {
    entry(uc.user).companyRoles.push({ companyId: uc.companyId, companyName: uc.company.name, role: uc.role });
  }
  res.json([...users.values()].sort((a, b) => a.email.localeCompare(b.email)));
});

/** Korvaa käyttäjän toimistoroolin ja roolit toimiston yhtiöissä. Muiden toimistojen yhtiöihin ei kosketa. */
export const updateUserAccess = handle(async (req, res) => {
  const { id: organizationId, userId } = req.params;
  await requireOrgAdmin(req, organizationId);
  const { orgRole = null, companyRoles = [] } = req.body;
  const allowed = await orgCompanyIds(organizationId);
  const invalid = validateAssignment(orgRole, companyRoles, allowed);
  if (invalid) throw new HttpError(400, invalid);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, 'Käyttäjää ei löydy');
  const owners = (await prisma.organizationMember.findMany({ where: { organizationId, role: 'OWNER' } })).map((o) => o.userId);
  if (wouldRemoveLastOwner(owners, userId, orgRole)) throw new HttpError(400, 'Toimistolla on oltava vähintään yksi omistaja');
  if (orgRole === 'OWNER' && req.user?.role !== 'SUPER_ADMIN' && !owners.includes(req.user!.userId)) {
    throw new HttpError(403, 'Vain omistaja voi nimetä uuden omistajan');
  }

  await prisma.$transaction(async (tx) => {
    if (orgRole) {
      await tx.organizationMember.upsert({
        where: { userId_organizationId: { userId, organizationId } },
        create: { userId, organizationId, role: orgRole },
        update: { role: orgRole },
      });
    } else {
      await tx.organizationMember.deleteMany({ where: { userId, organizationId } });
    }
    await tx.userCompany.deleteMany({ where: { userId, companyId: { in: [...allowed] } } });
    if (companyRoles.length) {
      await tx.userCompany.createMany({
        data: companyRoles.map((c: any) => ({ userId, companyId: c.companyId, role: c.role })),
      });
    }
  });
  res.json({ ok: true });
});

/** Poistaa käyttäjän toimistosta ja kaikista toimiston yhtiöistä (käyttäjätili jää, muut toimistot ennalleen). */
export const removeUser = handle(async (req, res) => {
  const { id: organizationId, userId } = req.params;
  await requireOrgAdmin(req, organizationId);
  const owners = (await prisma.organizationMember.findMany({ where: { organizationId, role: 'OWNER' } })).map((o) => o.userId);
  if (wouldRemoveLastOwner(owners, userId, null)) throw new HttpError(400, 'Toimiston ainoaa omistajaa ei voi poistaa');
  const allowed = [...(await orgCompanyIds(organizationId))];
  await prisma.$transaction([
    prisma.organizationMember.deleteMany({ where: { userId, organizationId } }),
    prisma.userCompany.deleteMany({ where: { userId, companyId: { in: allowed } } }),
  ]);
  res.json({ ok: true });
});

/** Kutsu: palauttaa linkin, jonka isännöitsijä lähettää kutsuttavalle. */
export const createInvitation = handle(async (req, res) => {
  const organizationId = req.params.id;
  await requireOrgAdmin(req, organizationId);
  const { email, orgRole = null, companyRoles = [] } = req.body;
  if (typeof email !== 'string' || !EMAIL.test(email.trim())) throw new HttpError(400, 'Virheellinen sähköpostiosoite');
  const invalid = validateAssignment(orgRole, companyRoles, await orgCompanyIds(organizationId));
  if (invalid) throw new HttpError(400, invalid);
  if (orgRole === 'OWNER') throw new HttpError(400, 'Omistajaksi ei voi kutsua; nimeä omistaja kutsun hyväksymisen jälkeen');

  const normalized = email.trim().toLowerCase();
  // Vanha avoin kutsu samalle osoitteelle korvataan
  await prisma.invitation.deleteMany({ where: { organizationId, email: normalized, acceptedAt: null } });
  const invitation = await prisma.invitation.create({
    data: {
      organizationId,
      email: normalized,
      orgRole,
      companyRoles,
      token: newInvitationToken(),
      invitedBy: req.user!.userId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * DAY),
    },
  });
  res.status(201).json({ ...invitation, link: invitationLink(invitation.token) });
});

export const listInvitations = handle(async (req, res) => {
  const organizationId = req.params.id;
  await requireOrgAdmin(req, organizationId);
  const invitations = await prisma.invitation.findMany({
    where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(invitations.map((i) => ({ ...i, link: invitationLink(i.token) })));
});

export const cancelInvitation = handle(async (req, res) => {
  const { id: organizationId, invitationId } = req.params;
  await requireOrgAdmin(req, organizationId);
  await prisma.invitation.deleteMany({ where: { id: invitationId, organizationId, acceptedAt: null } });
  res.json({ ok: true });
});

/** Toimiston jäsenet nimineen (tehtävien jakoon). Näkyy kaikille toimiston jäsenille. */
export const listMembers = handle(async (req, res) => {
  const organizationId = req.params.id;
  if (!req.user) throw new HttpError(401, 'Tunnistautuminen vaaditaan');
  if (req.user.role !== 'SUPER_ADMIN' && !(await getOrgRole(req.user.userId, organizationId))) {
    throw new HttpError(403, 'Et ole tämän toimiston jäsen');
  }
  const members = await prisma.organizationMember.findMany({ where: { organizationId }, include: { user: true } });
  res.json(members
    .filter((m) => m.user.isActive)
    .map((m) => ({
      id: m.userId,
      email: m.user.email,
      name: [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') || m.user.email,
      orgRole: m.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fi')));
});
