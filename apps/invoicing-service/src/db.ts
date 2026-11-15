import { PrismaClient } from '../prisma/client';

/** Yksi tietokantayhteys koko palvelulle. */
export const prisma = new PrismaClient();
