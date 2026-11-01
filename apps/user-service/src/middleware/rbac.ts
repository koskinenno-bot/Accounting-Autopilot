import { Request, Response, NextFunction } from 'express';

// Prisma-skeemassa rooli on String-kenttä, joten '@prisma/client' ei tarjoa Role-enumia
// (aiempi import oli rikki). Roolit määritellään tässä, arvot samat kuin User.role-kentässä.
export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  BOARD_MEMBER: 'BOARD_MEMBER',
  PROPERTY_MANAGER: 'PROPERTY_MANAGER',
  SHAREHOLDER: 'SHAREHOLDER',
  ACCOUNTANT: 'ACCOUNTANT',
  VIEWER: 'VIEWER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const requireRole = (allowedRoles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Note: req.user should be populated by an authentication middleware previously
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Tunnistautuminen vaaditaan' });
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ 
        error: 'Pääsy kielletty', 
        message: `Tämä toiminto vaatii jonkin seuraavista rooleista: ${allowedRoles.join(', ')}` 
      });
    }

    next();
  };
};

export const isAdmin = requireRole([Role.SUPER_ADMIN, Role.COMPANY_ADMIN]);
export const isManager = requireRole([Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.PROPERTY_MANAGER]);
export const isAccountant = requireRole([Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.ACCOUNTANT]);
export const isBoardMember = requireRole([Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.PROPERTY_MANAGER, Role.BOARD_MEMBER]);
