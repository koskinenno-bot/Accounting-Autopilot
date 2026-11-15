import { PrismaClient } from '../prisma/client';

/** Yksi tietokantayhteys koko palvelulle (yhden prosessin tilassa VOUCHER_DATABASE_URL). */
export const prisma = new PrismaClient({ datasourceUrl: process.env.VOUCHER_DATABASE_URL || undefined });
