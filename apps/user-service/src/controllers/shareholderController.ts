import { Request, Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { canWrite, getCompanyRole } from '../access';

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
