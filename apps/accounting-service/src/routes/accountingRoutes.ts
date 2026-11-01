import { Router, Request, Response } from 'express';
import * as entryController from '../controllers/entryController';
import { getAccounts } from '../services/chartOfAccountsService';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// Kaikki kirjanpidon rajapinnat vaativat kirjautumisen (aiemmin täysin avoimia).
router.use(requireAuth);

router.post('/entries', entryController.createEntry as any);
router.patch('/entries/:id', entryController.updateEntry as any);
router.delete('/entries/:id', entryController.deleteEntry as any);
router.post('/entries/:id/post', entryController.postEntry as any);
router.get('/ledger', entryController.getLedger as any);
router.get('/stats', entryController.getStats as any);

router.get('/fiscal-years', entryController.listFiscalYears as any);
router.post('/fiscal-years', entryController.createFiscalYear as any);
router.post('/fiscal-years/:id/close', entryController.closeFiscalYear as any);

router.get('/accounts', (async (req: Request, res: Response) => {
  const { companyId } = req.query;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });
  return res.json(await getAccounts(companyId as string));
}) as any);

export default router;
