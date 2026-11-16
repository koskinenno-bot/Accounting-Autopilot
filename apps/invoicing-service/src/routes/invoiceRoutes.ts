import { Router } from 'express';
import * as invoiceController from '../controllers/invoiceController';
import * as fees from '../controllers/feeController';
import * as reskontra from '../controllers/reskontraController';
import { getPortalInvoices } from '../controllers/portalController';
import { requireAuth, requireCompanyAccess } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);
// :id-reitit tarkistavat laskun yhtiön käsittelijässä
const company = requireCompanyAccess({ required: true });

// Osakasportaali: omat laskut (rajaus user-servicen /portal/me mukaan, ei yhtiöroolia)
router.get('/portal', getPortalInvoices as any);

// Vastikeperusteet ja laskutusajo (käyttöoikeus tarkistetaan käsittelijässä: perusteet vain isännöitsijä)
router.get('/fees', fees.getFeeSetup as any);
router.post('/fees/components', fees.createComponent as any);
router.post('/fees/defaults', fees.createDefaultComponents as any);
router.patch('/fees/components/:id', fees.updateComponent as any);
router.post('/fees/payoffs', fees.createPayoff as any);
router.delete('/fees/payoffs/:id', fees.deletePayoff as any);
router.put('/fees/settings', fees.updateSettings as any);
router.post('/fees/run', fees.runFees as any);
// Reskontra: saldot, suoritukset ja maksumuistutukset
router.get('/reskontra', reskontra.getReskontra as any);
router.get('/reminders', reskontra.getReminders as any);
router.post('/reminders', reskontra.sendReminders as any);
router.post('/:id/payments', reskontra.addPayment as any);

router.post('/', company, invoiceController.createInvoice as any);
router.get('/', company, invoiceController.getInvoices as any);
router.get('/:id/xml', invoiceController.getFinvoiceXml as any);
router.patch('/:id/status', invoiceController.updateInvoiceStatus as any);
router.post('/bulk-maintenance-fees', company, invoiceController.generateBulkMaintenanceFees as any);

export default router;
