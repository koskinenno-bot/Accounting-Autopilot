import { PrismaClient } from '../prisma/client';

export const prisma = new PrismaClient({ datasourceUrl: process.env.BANK_DATABASE_URL || undefined });
