import { Request, Response } from 'express';
import { prisma } from '../db';
import { assertCompanyAccess, getCompanyRole, roleAllows } from '../middleware/requireAuth';
import { beatCounts, dayOf, manualEntryProblem, summarize } from '../timeTracking';

const MAX_COMPANIES = 200;
const userOf = (req: Request): string | undefined => (req as any).user?.userId;

/**
 * POST /time/heartbeat { companyId }
 * Dashboard lähettää minuutin välein, kun käyttäjä on aktiivinen yhtiön sivuilla. Vain kirjanpitoa
 * tekevät (isännöitsijä, assistentti) mitataan: hallituksen katselu ei ole isännöitsijän työaikaa.
 */
export const heartbeat = async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { companyId } = req.body ?? {};
    if (!userId || userId === 'service') return res.status(400).json({ error: 'Ei käyttäjää' });
    if (typeof companyId !== 'string' || !companyId) return res.status(400).json({ error: 'companyId on pakollinen' });
    const role = await getCompanyRole(req, companyId);
    if (!role) return res.status(403).json({ error: 'Ei käyttöoikeutta tähän yhtiöön' });
    if (!roleAllows(role, 'write')) return res.json({ counted: false });

    const now = new Date();
    const day = dayOf(now);
    const key = { companyId_userId_day: { companyId, userId, day } };
    const existing = await prisma.activeTime.findUnique({ where: key });
    if (!existing) {
      await prisma.activeTime.create({ data: { companyId, userId, day, minutes: 1, lastBeat: now } })
        .catch(async () => { /* rinnakkainen ensimmäinen merkki: rivi syntyi jo */ });
      return res.json({ counted: true });
    }
    if (!beatCounts(existing.lastBeat, now)) return res.json({ counted: false });
    // Ehto lastBeat-kentässä estää kahden yhtäaikaisen merkin laskemisen kahdesti
    const r = await prisma.activeTime.updateMany({
      where: { id: existing.id, lastBeat: existing.lastBeat },
      data: { minutes: { increment: 1 }, lastBeat: now },
    });
    return res.json({ counted: r.count === 1 });
  } catch (error) {
    console.error('Time heartbeat error:', error);
    return res.status(500).json({ error: 'Ajan tallennus epäonnistui' });
  }
};

/** GET /time/summary?companyIds=a,b,c -> ajankäyttö yhtiöittäin (yhtiöt ilman oikeutta jätetään pois). */
export const getSummary = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.companyIds === 'string' ? req.query.companyIds : '';
    const requested = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_COMPANIES);
    if (requested.length === 0) return res.status(400).json({ error: 'companyIds on pakollinen' });
    const allowed: string[] = [];
    for (const id of requested) {
      if (roleAllows(await getCompanyRole(req, id), 'read')) allowed.push(id);
    }
    if (allowed.length === 0) return res.json([]);

    const today = new Date();
    const since = new Date(dayOf(today).getTime() - 365 * 86_400_000);
    const where = { companyId: { in: allowed }, day: { gte: since } };
    const [auto, manual, firstAuto, firstManual] = await Promise.all([
      prisma.activeTime.groupBy({ by: ['companyId', 'day'], where, _sum: { minutes: true } }),
      prisma.timeEntry.groupBy({ by: ['companyId', 'day'], where, _sum: { minutes: true } }),
      prisma.activeTime.aggregate({ where: { companyId: { in: allowed } }, _min: { day: true } }),
      prisma.timeEntry.aggregate({ where: { companyId: { in: allowed } }, _min: { day: true } }),
    ]);
    const rows = [...auto, ...manual].map((r) => ({ companyId: r.companyId, day: r.day, minutes: r._sum.minutes ?? 0 }));
    const firsts = [firstAuto._min.day, firstManual._min.day].filter(Boolean) as Date[];
    const firstDay = firsts.length ? new Date(Math.min(...firsts.map((d) => d.getTime()))) : null;
    return res.json(summarize(allowed, rows, today, firstDay));
  } catch (error) {
    console.error('Time summary error:', error);
    return res.status(500).json({ error: 'Ajankäytön haku epäonnistui' });
  }
};

/** GET /time/entries?companyId= -> yhtiön käsin kirjatut ajat ja automaattinen aika käyttäjittäin (90 pv). */
export const listEntries = async (req: Request, res: Response) => {
  try {
    const companyId = req.query.companyId as string;
    const since = new Date(dayOf(new Date()).getTime() - 90 * 86_400_000);
    const [entries, auto] = await Promise.all([
      prisma.timeEntry.findMany({ where: { companyId, day: { gte: since } }, orderBy: [{ day: 'desc' }, { createdAt: 'desc' }] }),
      prisma.activeTime.groupBy({ by: ['userId'], where: { companyId, day: { gte: since } }, _sum: { minutes: true } }),
    ]);
    return res.json({
      entries,
      autoByUser: auto.map((a) => ({ userId: a.userId, minutes: a._sum.minutes ?? 0 })),
    });
  } catch (error) {
    console.error('Time entries error:', error);
    return res.status(500).json({ error: 'Ajankäytön haku epäonnistui' });
  }
};

/** POST /time/entries { companyId, day, minutes, note } — käsin kirjattu aika (isännöitsijä tai assistentti). */
export const createEntry = async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { companyId, day, minutes, note } = req.body ?? {};
    if (!userId || userId === 'service') return res.status(400).json({ error: 'Ei käyttäjää' });
    const problem = manualEntryProblem(minutes, day, new Date());
    if (problem) return res.status(400).json({ error: problem });
    const entry = await prisma.timeEntry.create({
      data: {
        companyId, userId, minutes, day: new Date(`${day}T00:00:00.000Z`),
        note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null,
      },
    });
    return res.status(201).json(entry);
  } catch (error) {
    console.error('Time entry create error:', error);
    return res.status(500).json({ error: 'Ajan tallennus epäonnistui' });
  }
};

/** DELETE /time/entries/:id — vain oma kirjaus, tai isännöitsijä. */
export const deleteEntry = async (req: Request, res: Response) => {
  try {
    const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) return res.status(404).json({ error: 'Kirjausta ei löydy' });
    if (!(await assertCompanyAccess(req, res, entry.companyId, 'write'))) return;
    if (entry.userId !== userOf(req) && (req as any).companyRole !== 'MANAGER') {
      return res.status(403).json({ error: 'Voit poistaa vain omia kirjauksiasi' });
    }
    await prisma.timeEntry.delete({ where: { id: entry.id } });
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Time entry delete error:', error);
    return res.status(500).json({ error: 'Poisto epäonnistui' });
  }
};
