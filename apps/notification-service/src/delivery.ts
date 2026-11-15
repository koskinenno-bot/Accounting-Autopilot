/**
 * Sähköpostin lähetys (nodemailer). Asetukset .env-tiedostossa:
 *   SMTP_HOST, SMTP_PORT (oletus 587), SMTP_SECURE=true (portti 465), SMTP_USER, SMTP_PASS,
 *   MAIL_FROM ("Nimi <osoite@domain.fi>"), MAIL_REPLY_TO (valinnainen), PRODUCT_NAME (viestien otsikko).
 * Ilman SMTP_HOSTia viestit tallennetaan kansioon outbox/ .eml-tiedostoina (kehitystila), eikä mitään lähetetä.
 */
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import nodemailer, { Transporter } from 'nodemailer';
import { PrismaClient } from '../prisma/client';

export interface EmailJob {
  notificationId: string; recipient: string; subject: string; template?: string; data?: Record<string, unknown>;
}

const TEMPLATE_DIR = path.join(__dirname, '../templates');
export const OUTBOX_DIR = path.join(__dirname, '../outbox');
const SAFE_TEMPLATE = /^[a-z0-9-]+$/;

export const mailMode = (): 'smtp' | 'outbox' => (process.env.SMTP_HOST ? 'smtp' : 'outbox');
export const fromAddress = () => process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';

let transporter: Transporter | null = null;
const getTransporter = (): Transporter => {
  if (transporter) return transporter;
  if (mailMode() === 'smtp') {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  } else {
    transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  }
  return transporter;
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Tekstistä HTML: rivinvaihdot säilyvät, osoitteet muuttuvat linkeiksi. */
export const textToHtml = (text: string) => escapeHtml(text)
  .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#2563eb">${url}</a>`)
  .replace(/\n/g, '<br>');

export const htmlToText = (html: string) => html
  .replace(/<\/td>\s*<td[^>]*>/gi, ': ').replace(/<\/tr>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n').trim();

const layout = (title: string, inner: string) => `<!DOCTYPE html>
<html lang="fi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<div style="max-width:600px;margin:0 auto;padding:24px">
<div style="font-size:13px;color:#64748b;margin-bottom:12px">${escapeHtml(process.env.PRODUCT_NAME || 'Taloyhtiön kirjanpito')}</div>
<div style="background:#ffffff;border-radius:10px;padding:24px;line-height:1.55;font-size:15px">${inner}</div>
<div style="font-size:12px;color:#94a3b8;margin-top:12px">Tämä on automaattinen viesti.</div>
</div></body></html>`;

/** Renderöi viestin: templates/<nimi>.ejs tai yleinen tekstiviesti (data.body). Palauttaa HTML:n ja tekstiversion. */
export const renderEmail = async (subject: string, template: string | undefined, data: Record<string, unknown> = {}) => {
  const name = template && SAFE_TEMPLATE.test(template) && fs.existsSync(path.join(TEMPLATE_DIR, `${template}.ejs`)) ? template : null;
  let inner: string;
  if (name) inner = String(await ejs.renderFile(path.join(TEMPLATE_DIR, `${name}.ejs`), { ...data, textToHtml }));
  else if (typeof data.body === 'string') inner = `<p>${textToHtml(data.body)}</p>`;
  else throw new Error(`Tuntematon viestipohja: ${template}`);
  const text = typeof data.body === 'string' ? data.body : htmlToText(inner);
  return { html: layout(subject, inner), text };
};

/** Lähettää yhden viestin ja päivittää tilan. Heittää virheen, jotta jono voi yrittää uudelleen. */
export const deliver = async (prisma: PrismaClient, job: EmailJob) => {
  try {
    const { html, text } = await renderEmail(job.subject, job.template, job.data);
    const info: any = await getTransporter().sendMail({
      from: fromAddress(), replyTo: process.env.MAIL_REPLY_TO || undefined, to: job.recipient, subject: job.subject, html, text,
    });
    let note: string | null = null;
    if (mailMode() === 'outbox') {
      fs.mkdirSync(OUTBOX_DIR, { recursive: true });
      const file = path.join(OUTBOX_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}_${job.notificationId.slice(0, 8)}.eml`);
      fs.writeFileSync(file, info.message);
      note = `Ei lähetetty (SMTP ei käytössä), tallennettu: outbox/${path.basename(file)}`;
    }
    await prisma.notification.update({
      where: { id: job.notificationId },
      data: { content: html, status: mailMode() === 'outbox' ? 'OUTBOX' : 'SENT', sentAt: new Date(), errorMessage: note },
    });
    return { ok: true, mode: mailMode(), messageId: info.messageId as string | undefined };
  } catch (err: any) {
    await prisma.notification.update({
      where: { id: job.notificationId }, data: { status: 'FAILED', errorMessage: String(err?.message ?? err).slice(0, 500) },
    }).catch(() => undefined);
    throw err;
  }
};

/** Yhteystesti SMTP-palvelimeen (kirjautuminen), ei lähetä viestiä. */
export const verifySmtp = async (): Promise<{ mode: 'smtp' | 'outbox'; ok: boolean; error?: string }> => {
  if (mailMode() === 'outbox') return { mode: 'outbox', ok: true };
  try {
    await getTransporter().verify();
    return { mode: 'smtp', ok: true };
  } catch (err: any) {
    return { mode: 'smtp', ok: false, error: String(err?.message ?? err) };
  }
};
