import { PrismaClient } from '../prisma/client';

/** Yksi jaettu PrismaClient koko palvelulle. */
export const prisma = new PrismaClient({ datasourceUrl: process.env.USER_DATABASE_URL || undefined });
