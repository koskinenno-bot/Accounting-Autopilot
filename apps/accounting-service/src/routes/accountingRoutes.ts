import { Router, Request, Response } from 'express';
import * as entryController from '../controllers/entryController';
import * as fiscal from '../controllers/fiscalController';
import { getOverview } from '../controllers/overviewController';
import { getQueue, updateTask } from '../controllers/queueController';
import { getAccounts } from '../services/chartOfAccountsService';
import { createAccount, updateAccount } from '../controllers/accountController';
import { requireAuth, requireCompanyAccess } from '../middleware/requireAuth';

const router = Router();

// Kaikki kirjanpidon rajapinnat vaativat kirjautumisen (aiemmin täysin avoimia).
router.use(requireAuth);
// companyId querystä/bodystä => jäsenyys tarkistetaan; :id-reitit tarkistavat kohteen yhtiön käsittelijässä.
const company = requireCompanyAccess({ required: true });

router.post('/entries', company, entryController.createEntry as any);
router.patch('/entries/:id', entryController.updateEntry as any);
router.delete('/entries/:id', entryController.deleteEntry as any);
router.post('/entries/post-auto', company, entryController.postAutoApprovable as any);
router.post('/entries/:id/post', entryController.postEntry as any);
router.get('/purchase-invoices', company, entryController.listPurchaseInvoices as any);
router.get('/ledger', company, entryController.getLedger as any);
router.get('/stats', company, entryController.getStats as any);
// Kaikkien yhtiöiden tilanne isännöitsijän etusivulle (tarkistaa jokaisen yhtiön erikseen)
router.get('/overview', getOverview as any);
// Poikkeusjono: kaikkien yhtiöiden tehtävät ja niiden jako toimiston sisällä
router.get('/queue', getQueue as any);
router.put('/queue/task', updateTask as any);

router.get('/fiscal-years', company, entryController.listFiscalYears as any);
router.post('/fiscal-years', company, entryController.createFiscalYear as any);
// Tilinpäätös: :id-reitit tarkistavat tilikauden yhtiön käsittelijässä
router.post('/fiscal-years/:id/close', fiscal.closeFiscalYear as any);
router.get('/fiscal-years/:id/closing-checklist', fiscal.getClosingChecklist as any);
router.post('/fiscal-years/:id/opening-balances', fiscal.setOpeningBalances as any);
router.get('/fiscal-years/:id/depreciation', fiscal.getDepreciation as any);
router.post('/fiscal-years/:id/depreciation', fiscal.postDepreciation as any);
router.get('/fiscal-years/:id/accruals', fiscal.getAccruals as any);
router.post('/fiscal-years/:id/accruals', fiscal.createAccrual as any);
router.get('/assets', company, fiscal.listAssets as any);
router.post('/assets', company, fiscal.createAsset as any);

router.get('/accounts', company, (async (req: Request, res: Response) => {
  const { companyId } = req.query;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });
  return res.json(await getAccounts(companyId as string));
}) as any);

// Tilikartan muokkaus (vain isännöitsijä; tarkistus käsittelijässä)
router.post('/accounts', createAccount as any);
router.patch('/accounts/:id', updateAccount as any);

export default router;
