import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from './db';
import { EmailJob, deliver } from './delivery';

/**
 * Sähköpostijonon käsittelijä (BullMQ + Redis). Käynnistyy, kun Redis vastaa (myös myöhemmin).
 * Ilman Redistä viestit lähetetään suoraan (ks. notificationController).
 */
// BullMQ Worker vaatii maxRetriesPerRequest: null (blokkaavat komennot)
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
connection.on('error', () => undefined); // yhteysvirheet: ioredis yrittää uudelleen

let worker: Worker | null = null;
connection.on('ready', () => {
  if (worker) return;
  worker = new Worker('email-queue', async (job: Job<EmailJob>) => deliver(prisma, job.data), { connection, concurrency: 5 });
  worker.on('failed', (job, err) => {
    console.log(`[Sähköposti] ${job?.data?.recipient ?? ''}: lähetys epäonnistui (${job?.attemptsMade ?? 0}. yritys): ${err.message}`);
  });
  worker.on('error', () => undefined);
  console.log('Sähköpostijono käytössä (Redis).');
});
