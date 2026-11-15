import { PrismaClient } from '../prisma/client';

/** Yksi tietokantayhteys koko palvelulle (yhden prosessin tilassa NOTIFICATION_DATABASE_URL). */
export const prisma = new PrismaClient({ datasourceUrl: process.env.NOTIFICATION_DATABASE_URL || undefined });
