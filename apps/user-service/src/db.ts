import { PrismaClient } from '../prisma/client';

/** Yksi jaettu PrismaClient koko palvelulle. */
export const prisma = new PrismaClient();
