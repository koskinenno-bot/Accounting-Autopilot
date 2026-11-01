import { Request, Response } from 'express';
import { PrismaClient } from '../../prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

/** Onko kirjautuneella käyttäjällä pääsy yhtiöön (jäsenyys tai SUPER_ADMIN). */
const hasCompanyAccess = async (req: AuthRequest, companyId: string): Promise<boolean> => {
  if (!req.user || !companyId) return false;
  if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'SERVICE') return true;
  const membership = await prisma.userCompany.findUnique({
    where: { userId_companyId: { userId: req.user.userId, companyId } },
  });
  return Boolean(membership);
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

    if (!(await hasCompanyAccess(req, companyId))) {
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
            apartment: s.apartment, // { number, sqm, rooms, floor, shareOfCommonExpenses }
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
