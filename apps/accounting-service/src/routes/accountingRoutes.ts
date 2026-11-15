import { Router, Request, Response } from 'express';
import * as entryController from '../controllers/entryController';
import * as fiscal from '../controllers/fiscalController';
import { getOverview } from '../controllers/overviewController';
import { getQueue, updateTask } from '../controllers/queueController';
import { getAccounts } from '../services/chartOfAccountsService';
import { createAccount, updateAccount } from '../controllers/accountController';
import * as purchases from '../controllers/purchaseController';
import * as closingPackage from '../controllers/closingPackageController';
import * as migration from '../controllers/migrationController';
import * as vat from '../controllers/vatController';
import * as payroll from '../controllers/payrollController';
import * as bankRecon from '../controllers/bankReconController';
import * as time from '../controllers/timeController';
import * as voucherRequests from '../controllers/voucherRequestController';
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
// Ajankäyttö yhtiöittäin (tavoite alle 10 h / yhtiö / vuosi)
router.post('/time/heartbeat', time.heartbeat as any);
router.get('/time/summary', time.getSummary as any);
router.get('/time/entries', company, time.listEntries as any);
router.post('/time/entries', company, time.createEntry as any);
router.delete('/time/entries/:id', time.deleteEntry as any);
// Puuttuvat tositteet ja niiden pyyntö sähköpostilla
router.get('/missing-vouchers', company, voucherRequests.listMissing as any);
router.post('/missing-vouchers/request', company, voucherRequests.requestMissing as any);

router.get('/fiscal-years', company, entryController.listFiscalYears as any);
router.post('/fiscal-years', company, entryController.createFiscalYear as any);
// Tilinpäätös: :id-reitit tarkistavat tilikauden yhtiön käsittelijässä
router.post('/fiscal-years/:id/close', fiscal.closeFiscalYear as any);
router.get('/fiscal-years/:id/closing-checklist', fiscal.getClosingChecklist as any);
router.post('/fiscal-years/:id/opening-balances', fiscal.setOpeningBalances as any);
router.get('/fiscal-years/:id/depreciation', fiscal.getDepreciation as any);
router.post('/fiscal-years/:id/depreciation', fiscal.postDepreciation as any);
// Arvonlisävero (moduuli 8)
router.get('/vat/settings', vat.getSettings as any);
router.put('/vat/settings', vat.updateSettings as any);
router.get('/vat/periods', vat.listPeriods as any);
router.get('/vat/return', vat.getReturn as any);
router.get('/vat/return/file', vat.getReturnFile as any);
router.post('/vat/settle', vat.settle as any);
router.get('/fiscal-years/:id/closing-package', closingPackage.getClosingPackage as any);
router.put('/fiscal-years/:id/closing-package', closingPackage.updateClosingPackage as any);
router.get('/fiscal-years/:id/tax-return', closingPackage.getTaxReturn as any);
router.get('/fiscal-years/:id/budget', closingPackage.getBudget as any);
router.put('/fiscal-years/:id/budget', closingPackage.updateBudget as any);
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

// Ostolaskujen hyväksyntä ja maksuaineistot (käyttöoikeus tarkistetaan käsittelijässä)
router.get('/migration', migration.listMigrations as any);
router.post('/migration/preview', migration.previewMigration as any);
router.post('/migration/import', migration.importMigration as any);
router.delete('/migration/:fiscalYearId', migration.undoMigration as any);

router.get('/purchases', purchases.listPurchases as any);
router.put('/purchases/policy', purchases.updatePolicy as any);
router.post('/purchases/:id/decision', purchases.decide as any);
router.delete('/purchases/:id/decision', purchases.withdrawDecision as any);
router.patch('/purchases/:id', purchases.updatePaymentDetails as any);
router.get('/payment-batches', purchases.listBatches as any);
router.post('/payment-batches', purchases.createBatch as any);
router.get('/payment-batches/:id/xml', purchases.downloadBatch as any);
router.patch('/payment-batches/:id', purchases.updateBatch as any);

// Palkat, tulorekisteri ja urakkatiedot (moduuli 9; käyttöoikeus tarkistetaan käsittelijässä)
router.get('/payroll/settings', payroll.getSettings as any);
router.put('/payroll/settings', payroll.updateSettings as any);
router.get('/payroll/payees', payroll.listPayees as any);
router.post('/payroll/payees', payroll.createPayee as any);
router.patch('/payroll/payees/:id', payroll.updatePayee as any);
router.get('/payroll/runs', payroll.listRuns as any);
router.post('/payroll/runs', payroll.createRun as any);
router.get('/payroll/runs/:id', payroll.getRun as any);
router.put('/payroll/runs/:id', payroll.updateRun as any);
router.delete('/payroll/runs/:id', payroll.deleteRun as any);
router.post('/payroll/runs/:id/post', payroll.postRun as any);
router.post('/payroll/runs/:id/reported', payroll.markRunReported as any);
router.get('/payroll/reports', payroll.getReports as any);
router.post('/payroll/reports/mark', payroll.markReport as any);
router.get('/payroll/contracts/report', payroll.getContractReport as any);
router.get('/payroll/contracts', payroll.listContracts as any);
router.post('/payroll/contracts', payroll.createContract as any);
router.put('/payroll/contracts/:id', payroll.updateContract as any);
router.delete('/payroll/contracts/:id', payroll.deleteContract as any);

// Pankkitäsmäytys (käyttöoikeus tarkistetaan käsittelijässä)
router.post('/bank-balances', bankRecon.saveBalance as any);
router.delete('/bank-balances/:id', bankRecon.deleteBalance as any);
router.get('/bank-reconciliation', bankRecon.getReconciliation as any);
router.post('/bank-reconciliation/mark', bankRecon.markReconciled as any);

export default router;
