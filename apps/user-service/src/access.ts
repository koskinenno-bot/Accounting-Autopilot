/**
 * Käyttöoikeuksien tietokantaa käyttävät apurit. Säännöt: accessRules.ts.
 */
import { randomBytes } from 'crypto';
import { prisma } from './db';
import { CompanyRole, OrgRole, effectiveCompanyRole, isOrgAdmin, isOrgRole } from './accessRules';

export * from './accessRules';

export const newInvitationToken = () => randomBytes(24).toString('base64url');

export const dashboardUrl = () => (process.env.DASHBOARD_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Käyttäjän tehokas rooli yhtiössä tietokannasta. */
export const getCompanyRole = async (user: { userId: string; role: string }, companyId: string): Promise<CompanyRole | null> => {
  if (user.role === 'SUPER_ADMIN' || user.role === 'SERVICE') return 'MANAGER';
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { organizationId: true } });
  if (!company) return null;
  const [membership, orgMember] = await Promise.all([
    prisma.userCompany.findUnique({ where: { userId_companyId: { userId: user.userId, companyId } } }),
    company.organizationId
      ? prisma.organizationMember.findUnique({
          where: { userId_organizationId: { userId: user.userId, organizationId: company.organizationId } },
        })
      : null,
  ]);
  return effectiveCompanyRole(user.role, membership?.role, orgMember?.role);
};

/** Käyttäjän rooli toimistossa (null = ei jäsen). */
export const getOrgRole = async (userId: string, organizationId: string): Promise<OrgRole | null> => {
  const m = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
  return m && isOrgRole(m.role) ? m.role : null;
};

/**
 * Varmistaa, että käyttäjällä on toimisto. Vanhat käyttäjät (ennen toimistomallia) saavat oman
 * toimiston automaattisesti, ja heidän yhtiönsä liitetään siihen. Ulkopuoliset (hallitus, tarkastaja),
 * joilla on vain yhtiörooleja muiden toimistojen yhtiöissä, eivät saa toimistoa.
 */
export const ensureOrganization = async (userId: string): Promise<void> => {
  const existing = await prisma.organizationMember.findFirst({ where: { userId } });
  if (existing) return;
  const memberships = await prisma.userCompany.findMany({ where: { userId }, include: { company: true } });
  const orphanCompanies = memberships.filter((m) => !m.company.organizationId);
  // Käyttäjä, jolla on vain muiden toimistojen yhtiöitä, on ulkopuolinen.
  if (memberships.length > 0 && orphanCompanies.length === 0) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: `${name} (toimisto)` } });
    await tx.organizationMember.create({ data: { userId, organizationId: org.id, role: 'OWNER' } });
    if (orphanCompanies.length) {
      await tx.company.updateMany({
        where: { id: { in: orphanCompanies.map((m) => m.companyId) }, organizationId: null },
        data: { organizationId: org.id },
      });
    }
  });
};

/** Yhtiöt, jotka käyttäjä näkee, ja hänen roolinsa kussakin. */
export const listVisibleCompanies = async (user: { userId: string; role: string }) => {
  if (user.role === 'SUPER_ADMIN') {
    const all = await prisma.company.findMany({ orderBy: { name: 'asc' } });
    return all.map((c) => ({ ...c, myRole: 'MANAGER' as CompanyRole }));
  }
  const [memberships, orgMembers] = await Promise.all([
    prisma.userCompany.findMany({ where: { userId: user.userId }, include: { company: true } }),
    prisma.organizationMember.findMany({ where: { userId: user.userId } }),
  ]);
  const adminOrgIds = orgMembers.filter((m) => isOrgAdmin(m.role)).map((m) => m.organizationId);
  const orgCompanies = adminOrgIds.length
    ? await prisma.company.findMany({ where: { organizationId: { in: adminOrgIds } } })
    : [];

  const byId = new Map<string, any>();
  for (const c of orgCompanies) byId.set(c.id, { ...c, myRole: 'MANAGER' });
  for (const m of memberships) {
    const orgRole = orgMembers.find((o) => o.organizationId === m.company.organizationId)?.role;
    const role = effectiveCompanyRole(user.role, m.role, orgRole);
    if (role) byId.set(m.companyId, { ...m.company, myRole: role });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fi'));
};
