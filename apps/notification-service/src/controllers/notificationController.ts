import { Request, Response } from 'express';
import { PrismaClient } from '../../prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { EmailJob, deliver, fromAddress, mailMode, verifySmtp } from '../delivery';

const prisma = new PrismaClient();
// enableOfflineQueue: false => jos Redis ei vastaa, lisäys epäonnistuu heti ja viesti lähetetään suoraan
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
connection.on('error', () => undefined);
const emailQueue = new Queue('email-queue', { connection });
let warned = false;
emailQueue.on('error', () => {
  if (!warned) console.log('Redis ei vastaa: sähköpostit lähetetään suoraan ilman jonoa.');
  warned = true;
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Jonoon (3 yritystä) tai Redisin puuttuessa suoraan. */
const dispatch = async (job: EmailJob) => {
  if (connection.status === 'ready') {
    try {
      await emailQueue.add('send-email', job, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000 });
      return 'queued';
    } catch {
      // Redis katkesi: lähetetään suoraan
    }
  }
  await deliver(prisma, job);
  return 'sent';
};

export const sendEmail = async (req: Request, res: Response) => {
  try {
    const { companyId, recipient, subject, template, data } = req.body ?? {};
    if (typeof recipient !== 'string' || !EMAIL.test(recipient.trim())) return res.status(400).json({ error: 'Virheellinen vastaanottaja' });
    if (typeof subject !== 'string' || !subject.trim()) return res.status(400).json({ error: 'Otsikko puuttuu' });
    const notification = await prisma.notification.create({
      data: { companyId: String(companyId ?? 'system'), recipient: recipient.trim(), subject: subject.trim().slice(0, 200), content: `Pohja: ${template ?? 'teksti'}`, status: 'PENDING' },
    });
    const job: EmailJob = { notificationId: notification.id, recipient: recipient.trim(), subject: subject.trim().slice(0, 200), template, data };
    let how: string;
    try {
      how = await dispatch(job);
    } catch (err: any) {
      return res.status(502).json({ error: `Sähköpostin lähetys epäonnistui: ${err?.message ?? err}`, notificationId: notification.id });
    }
    res.status(202).json({ message: how === 'queued' ? 'Viesti jonossa' : 'Viesti käsitelty', notificationId: notification.id, mode: mailMode() });
  } catch (error) {
    console.error('Sähköpostivirhe:', error);
    res.status(500).json({ error: 'Viestin käsittely epäonnistui' });
  }
};

export const getHistory = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.query;
    const history = await prisma.notification.findMany({
      where: { companyId: companyId as string },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notification history' });
  }
};

/** GET /notify/status : lähetystapa ja SMTP-yhteyden tila (ei salasanoja). */
export const getStatus = async (_req: Request, res: Response) => {
  const smtp = await verifySmtp();
  res.json({ ...smtp, from: fromAddress(), queue: connection.status === 'ready' ? 'redis' : 'suora' });
};

/** POST /notify/test { companyId, recipient } : testiviesti. */
export const sendTest = async (req: Request, res: Response) => {
  req.body = {
    companyId: req.body?.companyId, recipient: req.body?.recipient, subject: 'Testiviesti',
    data: { body: 'Hei,\n\ntämä on testiviesti. Jos sait tämän, sähköpostin lähetys toimii.' },
  };
  return sendEmail(req, res);
};
