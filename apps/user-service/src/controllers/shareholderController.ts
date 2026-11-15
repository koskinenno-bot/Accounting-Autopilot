import { Request, Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { canWrite, getCompanyRole } from '../access';
import { parseShareholderCsv } from '../shareholderImport';

/** Pääsy yhtiöön; write=true vaatii kirjoitusoikeuden (isännöitsijä tai assistentti). */
const hasCompanyAccess = async (req: AuthRequest, companyId: string, write = false): Promise<boolean> => {
  if (!req.user || typeof companyId !== 'string' || !companyId) return false;
  const role = await getCompanyRole(req.user, companyId);
  return Boolean(role) && (!write || canWrite(role));
};

export const createShareholder = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      companyId, 
      personType, 
      firstName, 
      lastName, 
      companyName, 
      email, 
      phone, 
      address,
      shares 
    } = req.body;

    if (!(await hasCompanyAccess(req, companyId, true))) {
      return res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
    }

    const shareholder = await prisma.shareholder.create({
      data: {
        companyId,
        personType,
        firstName,
        lastName,
        companyName,
        email,
        phone,
        address,
        shares: {
          create: (Array.isArray(shares) ? shares : []).map((s: any) => ({
            shareNumbers: s.shareNumbers,
            apartment: s.apartment, // { number, squareMeters, rooms, floor, shareOfCommonExpenses } (vastikelaskutus lukee squareMeters)
            ownershipStart: new Date(s.ownershipStart || Date.now()),
            ownershipPercentage: s.ownershipPercentage || 1.0,
          }))
        }
      },
      include: { shares: true }
    });

    res.status(201).json(shareholder);
  } catch (error) {
    console.error('Create shareholder error:', error);
    res.status(500).json({ error: 'Failed to create shareholder' });
  }
};

export const getShareholders = async (req: AuthRequest, res: Response) => {
  try {
    const { companyId } = req.query;
    if (!(await hasCompanyAccess(req, companyId as string))) {
      return res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
    }
    const shareholders = await prisma.shareholder.findMany({
      where: { companyId: companyId as string },
      include: { shares: true }
    });
    res.json(shareholders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shareholders' });
  }
};

/**
 * Osakasluettelon tuonti CSV:nä. dryRun=true palauttaa esikatselun. Tuonti korvaa yhtiön osakasluettelon
 * kokonaan (isännöintijärjestelmä on osakasluettelon lähde); osakkaan käyttäjälinkki säilyy sähköpostin perusteella.
 */
export const importShareholders = async (req: AuthRequest, res: Response) => {
  try {
    const { companyId, csv, dryRun } = req.body ?? {};
    if (!(await hasCompanyAccess(req, companyId, true))) {
      return res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
    }
    if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'CSV-tiedosto puuttuu' });
    if (csv.length > 2_000_000) return res.status(400).json({ error: 'Tiedosto on liian suuri' });
    const parsed = parseShareholderCsv(csv);
    const summary = {
      apartments: parsed.apartments.length,
      owners: parsed.apartments.reduce((s, a) => s + a.owners.length, 0),
      errors: parsed.errors,
      warnings: parsed.warnings,
      preview: parsed.apartments,
    };
    if (dryRun || parsed.errors.length || !parsed.apartments.length) {
      return res.status(parsed.errors.length && !dryRun ? 400 : 200).json({ ...summary, imported: false });
    }

    const existing = await prisma.shareholder.findMany({ where: { companyId }, select: { email: true, userId: true } });
    const userByEmail = new Map(existing.filter((s) => s.userId).map((s) => [s.email.toLowerCase(), s.userId]));
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.shareholder.deleteMany({ where: { companyId } }); // osakkeet poistuvat cascadella
      for (const apt of parsed.apartments) {
        for (const owner of apt.owners) {
          await tx.shareholder.create({
            data: {
              companyId,
              personType: owner.businessId ? 'company' : 'individual',
              firstName: owner.firstName,
              lastName: owner.lastName,
              companyName: owner.companyName,
              businessId: owner.businessId,
              email: owner.email,
              phone: owner.phone,
              userId: owner.email ? userByEmail.get(owner.email) ?? null : null,
              shares: {
                create: [{
                  shareNumbers: apt.shareNumbers,
                  apartment: { number: apt.number, squareMeters: apt.squareMeters, persons: apt.persons, parkingSpots: apt.parkingSpots },
                  ownershipStart: now,
                  ownershipPercentage: Math.round((1 / apt.owners.length) * 10000) / 10000,
                }],
              },
            },
          });
        }
      }
    });
    return res.status(201).json({ ...summary, preview: undefined, imported: true });
  } catch (error) {
    console.error('Shareholder import error:', error);
    res.status(500).json({ error: 'Osakasluettelon tuonti epäonnistui' });
  }
};

/** Huoneiston tiedot (pinta-ala, henkilöt, autopaikat) kaikille sen omistajille. */
export const updateApartment = async (req: AuthRequest, res: Response) => {
  try {
    const { companyId, apartment, squareMeters, persons, parkingSpots } = req.body ?? {};
    if (!(await hasCompanyAccess(req, companyId, true))) {
      return res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
    }
    const patch: Record<string, number> = {};
    for (const [key, value] of Object.entries({ squareMeters, persons, parkingSpots })) {
      if (value === undefined) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || (key !== 'squareMeters' && !Number.isInteger(n))) {
        return res.status(400).json({ error: `Virheellinen arvo: ${key}` });
      }
      patch[key] = n;
    }
    const shares = await prisma.share.findMany({ where: { shareholder: { companyId } } });
    const matching = shares.filter((s) => String((s.apartment as any)?.number ?? '') === String(apartment));
    if (!matching.length) return res.status(404).json({ error: 'Huoneistoa ei löydy' });
    await prisma.$transaction(matching.map((s) => prisma.share.update({
      where: { id: s.id },
      data: { apartment: { ...((s.apartment as any) ?? {}), ...patch } },
    })));
    res.json({ ok: true, updated: matching.length });
  } catch (error) {
    console.error('Apartment update error:', error);
    res.status(500).json({ error: 'Huoneiston päivitys epäonnistui' });
  }
};
