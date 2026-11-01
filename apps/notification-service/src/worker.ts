import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '../prisma/client';
import ejs from 'ejs';
import path from 'path';

const prisma = new PrismaClient();
// BullMQ Worker vaatii maxRetriesPerRequest: null (blokkaavat komennot)
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

const worker = new Worker('email-queue', async (job: Job) => {
  const { notificationId, recipient, subject, template, data } = job.data;
  
  console.log(`[Worker] Processing notification ${notificationId} for ${recipient}`);

  try {
    // 1. Render Template
    const templatePath = path.join(__dirname, `../templates/${template}.ejs`);
    const content = String(await ejs.renderFile(templatePath, data || {}));

    // 2. Mock Dispatch (In real prod, use Nodemailer here)
    console.log('--- BACKGROUND EMAIL DISPATCH ---');
    console.log(`To: ${recipient}`);
    console.log(`Subject: ${subject}`);
    console.log('---------------------------------');

    // 3. Update Database
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        content,
        status: 'SENT',
        sentAt: new Date()
      }
    });

    return { success: true, notificationId };
  } catch (error: any) {
    console.error(`[Worker] Failed to process ${notificationId}:`, error.message);
    
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'FAILED' }
    });
    
    throw error; // Let BullMQ handle retries
  }
}, { connection, concurrency: 5 });

worker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.log(`[Worker] Job ${job?.id} failed: ${err.message}`);
});

console.log('Notification Worker started and listening for jobs...');

export default worker;
