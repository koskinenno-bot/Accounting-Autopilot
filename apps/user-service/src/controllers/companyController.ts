import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { publishCompanyCreated } from '../utils/kafka';
import { v4 as uuidv4 } from 'uuid';
import { ensureOrganization, getCompanyRole, isOrgAdmin, listVisibleCompanies } from '../access';

const BUSINESS_ID = /^\d{7}-\d$/;
const COMPANY_TYPES = ['AS_OY', 'KOY'];

/** Uusi yhtiö luodaan käyttäjän toimistoon. Vain toimiston omistaja tai pääkäyttäjä voi luoda yhtiöitä. */
export const createCompany = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Tunnistautuminen vaaditaan' });
    const { businessId, name, housingCooperativeId, fiscalYearStart, fiscalYearEnd, settings, companyType } = req.body;

    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Yhtiön nimi puuttuu' });
    if (typeof businessId !== 'string' || !BUSINESS_ID.test(businessId.trim())) {
      return res.status(400).json({ error: 'Y-tunnuksen muoto on 1234567-8' });
    }
    const type = companyType ?? 'AS_OY';
    if (!COMPANY_TYPES.includes(type)) return res.status(400).json({ error: 'Yhtiömuoto on AS_OY tai KOY' });

    // Oletuksena kuluva kalenterivuosi
    const year = new Date().getUTCFullYear();
    const start = new Date(fiscalYearStart || `${year}-01-01`);
    const end = new Date(fiscalYearEnd || `${year}-12-31`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ error: 'Tilikauden päivämäärät ovat virheelliset' });
    }

    let organizationId: string | null = null;
    if (req.user.role !== 'SUPER_ADMIN') {
      await ensureOrganization(req.user.userId);
      const adminOf = await prisma.organizationMember.findMany({ where: { userId: req.user.userId } });
      const target = req.body.organizationId
        ? adminOf.find((m) => m.organizationId === req.body.organizationId)
        : adminOf.find((m) => isOrgAdmin(m.role));
      if (!target || !isOrgAdmin(target.role)) {
        return res.status(403).json({ error: 'Vain toimiston omistaja tai pääkäyttäjä voi lisätä yhtiöitä' });
      }
      organizationId = target.organizationId;
    } else if (typeof req.body.organizationId === 'string') {
      organizationId = req.body.organizationId;
    }

    const existing = await prisma.company.findUnique({ where: { businessId: businessId.trim() } });
    if (existing) return res.status(409).json({ error: 'Yhtiö tällä Y-tunnuksella on jo olemassa' });

    const company = await prisma.company.create({
      data: {
        businessId: businessId.trim(),
        name: name.trim(),
        housingCooperativeId,
        companyType: type,
        organizationId,
        fiscalYearStart: start,
        fiscalYearEnd: end,
        settings: settings || {},
        // Luoja on yhtiön isännöitsijä, vaikka toimiston rooli antaisi oikeuden muutenkin:
        // näin yhtiö pysyy hänen listallaan, jos toimistorooli muuttuu.
        users: { create: { userId: req.user.userId, role: 'MANAGER' } },
      },
    });

    await publishCompanyCreated({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: {
        companyId: company.id,
        businessId: company.businessId,
        name: company.name,
        fiscalYearStart: company.fiscalYearStart.toISOString(),
        fiscalYearEnd: company.fiscalYearEnd.toISOString(),
        chartOfAccountsTemplate: company.chartOfAccountsTemplate,
      },
    });

    return res.status(201).json({ ...company, myRole: 'MANAGER' });
  } catch (error) {
    console.error('Company creation error:', error);
    return res.status(500).json({ error: 'Yhtiön luonti epäonnistui' });
  }
};

/** Yhtiöt, jotka käyttäjä näkee: omat yhtiöroolit + toimiston kaikki yhtiöt omistajalle ja pääkäyttäjälle. */
export const getMyCompanies = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Tunnistautuminen vaaditaan' });
    if (req.user.role !== 'SUPER_ADMIN') await ensureOrganization(req.user.userId);
    return res.json(await listVisibleCompanies(req.user));
  } catch (error) {
    console.error('Company list error:', error);
    return res.status(500).json({ error: 'Yhtiöiden haku epäonnistui' });
  }
};

/**
 * Onko kirjautuneella käyttäjällä pääsy yhtiöön, ja millä roolilla? Muut palvelut kutsuvat tätä
 * käyttäjän omalla tunnisteella (requireAuth.ts). 200 { role } = pääsy, 403 = ei pääsyä.
 */
export const checkCompanyAccess = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Tunnistautuminen vaaditaan' });
    const role = await getCompanyRole(req.user, req.params.id);
    return role ? res.json({ role }) : res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
  } catch (error) {
    return res.status(500).json({ error: 'Käyttöoikeuden tarkistus epäonnistui' });
  }
};

export const getStats = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Tunnistautuminen vaaditaan' });
    const ids = (await listVisibleCompanies(req.user)).map((c) => c.id);
    const totalShareholders = await prisma.shareholder.count({ where: { companyId: { in: ids } } });
    return res.json({ totalCompanies: ids.length, totalShareholders });
  } catch (error) {
    return res.status(500).json({ error: 'Tilastojen haku epäonnistui' });
  }
};
