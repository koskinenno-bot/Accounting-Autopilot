import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { publishCompanyCreated } from '../utils/kafka';
import { v4 as uuidv4 } from 'uuid';
import { canManage, ensureOrganization, getCompanyRole, isOrgAdmin, listVisibleCompanies } from '../access';
import { formatIban, isValidIban, normalizeIban } from '../iban';

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

/**
 * PATCH /companies/:id { name?, iban?, bic? } -> yhtiön perustiedot (vain isännöitsijä).
 * Tilinumero tallennetaan asetuksiin; sitä käytetään laskuissa ja Finvoice-aineistossa.
 */
export const updateCompany = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Tunnistautuminen vaaditaan' });
    const role = await getCompanyRole(req.user, req.params.id);
    if (!role) return res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
    if (!canManage(role)) return res.status(403).json({ error: 'Vain isännöitsijä voi muuttaa yhtiön tietoja' });
    const { name, iban, bic } = req.body ?? {};
    const company = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!company) return res.status(404).json({ error: 'Yhtiötä ei löydy' });

    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) return res.status(400).json({ error: 'Nimi on pakollinen (enintään 200 merkkiä)' });
      data.name = name.trim();
    }
    const settings: Record<string, unknown> = { ...((company.settings as Record<string, unknown> | null) ?? {}) };
    if (iban !== undefined) {
      if (iban === null || iban === '') delete settings.iban;
      else if (!isValidIban(iban)) return res.status(400).json({ error: 'Tilinumero (IBAN) on virheellinen' });
      else settings.iban = normalizeIban(iban);
    }
    if (bic !== undefined) {
      if (bic === null || bic === '') delete settings.bic;
      else if (typeof bic !== 'string' || !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic.trim().toUpperCase())) return res.status(400).json({ error: 'BIC-tunnus on virheellinen' });
      else settings.bic = bic.trim().toUpperCase();
    }
    data.settings = settings;
    const saved = await prisma.company.update({ where: { id: company.id }, data });
    const s = (saved.settings as Record<string, unknown> | null) ?? {};
    return res.json({ ...saved, myRole: role, ibanFormatted: typeof s.iban === 'string' ? formatIban(s.iban) : null });
  } catch (error) {
    console.error('Company update error:', error);
    return res.status(500).json({ error: 'Yhtiön tietojen tallennus epäonnistui' });
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
