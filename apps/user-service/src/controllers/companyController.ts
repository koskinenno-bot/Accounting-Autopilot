import { Request, Response } from 'express';
import { PrismaClient } from '../../prisma/client';
import { AuthRequest } from '../middleware/auth';
import { publishCompanyCreated } from '../utils/kafka';
import { v4 as uuidv4 } from 'uuid';
const prisma = new PrismaClient();

export const createCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      businessId, 
      name, 
      housingCooperativeId, 
      fiscalYearStart, 
      fiscalYearEnd,
      settings 
    } = req.body;
    
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const company = await prisma.company.create({
      data: {
        businessId,
        name,
        housingCooperativeId,
        fiscalYearStart: new Date(fiscalYearStart),
        fiscalYearEnd: new Date(fiscalYearEnd),
        settings: settings || {},
        users: {
          create: {
            userId: req.user.userId
          }
        }
      },
    });

    // Publish event for accounting service
    await publishCompanyCreated({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      data: {
        companyId: company.id,
        businessId: company.businessId,
        name: company.name,
        fiscalYearStart: company.fiscalYearStart.toISOString(),
        fiscalYearEnd: company.fiscalYearEnd.toISOString(),
        chartOfAccountsTemplate: company.chartOfAccountsTemplate
      }
    });

    return res.status(201).json(company);
  } catch (error) {
    console.error('Company creation error:', error);
    return res.status(500).json({ error: 'Failed to create company' });
  }
};

export const getMyCompanies = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userCompanies = await prisma.userCompany.findMany({
      where: { userId: req.user.userId },
      include: { company: true }
    });

    return res.json(userCompanies.map(uc => uc.company));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch companies' });
  }
};

export const getStats = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    // Vain SUPER_ADMIN näkee koko järjestelmän luvut; muut omien yhtiöidensä.
    const scope = req.user.role === 'SUPER_ADMIN'
      ? {}
      : { users: { some: { userId: req.user.userId } } };
    const totalCompanies = await prisma.company.count({ where: scope });
    const totalShareholders = await prisma.shareholder.count({ where: { company: scope } });
    
    return res.json({
      totalCompanies,
      totalShareholders
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user-service stats' });
  }
};
