import { Request, Response } from 'express';
import { PrismaClient } from '../../prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
const emailQueue = new Queue('email-queue', { connection });

export const sendEmail = async (req: Request, res: Response) => {
  try {
    const { companyId, recipient, subject, template, data } = req.body;

    // 1. Save Notification Record with PENDING status
    const notification = await prisma.notification.create({
      data: {
        companyId,
        recipient,
        subject,
        content: `Template: ${template}`, // Placeholder until worker renders it
        status: 'PENDING',
      }
    });

    // 2. Add to BullMQ Queue
    await emailQueue.add('send-email', {
      notificationId: notification.id,
      companyId,
      recipient,
      subject,
      template,
      data
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    });

    console.log(`[Queue] Added notification ${notification.id} to email-queue`);

    res.status(202).json({ 
      message: 'Notification queued for delivery', 
      notificationId: notification.id 
    });
  } catch (error) {
    console.error('Queue error:', error);
    res.status(500).json({ error: 'Failed to queue notification' });
  }
};

export const getHistory = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.query;
    const history = await prisma.notification.findMany({
      where: { companyId: companyId as string },
      orderBy: { createdAt: 'desc' },
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notification history' });
  }
};
