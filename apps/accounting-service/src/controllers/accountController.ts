import { Request, Response } from 'express';
import { prisma } from '../db';
import { accountTypeFor } from '../services/chartOfAccountsService';
import { assertCompanyAccess } from '../middleware/requireAuth';

/**
 * Tilikartan muokkaus. Vain isännöitsijä (manage): tilikartta vaikuttaa kaikkiin raportteihin.
 * Tilin numero määrää sen paikan tuloslaskelmassa ja taseessa, joten numeroa ei voi muuttaa jälkikäteen;
 * käytöstä poistettu tili jää historiaan mutta ei näy uusille kirjauksille.
 */
export const createAccount = async (req: Request, res: Response) => {
  try {
    const { companyId, accountNumber, accountName } = req.body ?? {};
    if (!(await assertCompanyAccess(req, res, companyId, 'manage'))) return;
    const number = typeof accountNumber === 'string' ? accountNumber.trim() : String(accountNumber ?? '');
    const type = accountTypeFor(number);
    if (!type) return res.status(400).json({ error: 'Tilinumero on 4–6 numeroa väliltä 1000–9999' });
    if (typeof accountName !== 'string' || !accountName.trim()) return res.status(400).json({ error: 'Tilin nimi puuttuu' });
    const existing = await prisma.account.findUnique({ where: { companyId_accountNumber: { companyId, accountNumber: number } } });
    if (existing) return res.status(409).json({ error: `Tili ${number} on jo olemassa (${existing.accountName})` });
    const account = await prisma.account.create({
      data: { companyId, accountNumber: number, accountName: accountName.trim(), accountType: type },
    });
    return res.status(201).json(account);
  } catch (error) {
    console.error('Account create error:', error);
    return res.status(500).json({ error: 'Tilin lisäys epäonnistui' });
  }
};

export const updateAccount = async (req: Request, res: Response) => {
  try {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'Tiliä ei löydy' });
    if (!(await assertCompanyAccess(req, res, account.companyId, 'manage'))) return;
    const { accountName, isActive, accountNumber } = req.body ?? {};
    if (accountNumber !== undefined && String(accountNumber) !== account.accountNumber) {
      return res.status(400).json({ error: 'Tilinumeroa ei voi muuttaa. Lisää uusi tili ja poista vanha käytöstä.' });
    }
    if (accountName !== undefined && (typeof accountName !== 'string' || !accountName.trim())) {
      return res.status(400).json({ error: 'Tilin nimi puuttuu' });
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive on true tai false' });
    const updated = await prisma.account.update({
      where: { id: account.id },
      data: {
        ...(accountName !== undefined ? { accountName: accountName.trim() } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });
    return res.json(updated);
  } catch (error) {
    console.error('Account update error:', error);
    return res.status(500).json({ error: 'Tilin päivitys epäonnistui' });
  }
};
