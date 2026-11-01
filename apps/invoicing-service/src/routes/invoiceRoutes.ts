import { Router } from 'express';
import * as invoiceController from '../controllers/invoiceController';
import { requireAuth, requireCompanyAccess } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);
// :id-reitit tarkistavat laskun yhtiön käsittelijässä
const company = requireCompanyAccess({ required: true });

router.post('/', company, invoiceController.createInvoice as any);
router.get('/', company, invoiceController.getInvoices as any);
router.get('/:id/xml', invoiceController.getFinvoiceXml as any);
router.patch('/:id/status', invoiceController.updateInvoiceStatus as any);
router.post('/bulk-maintenance-fees', company, invoiceController.generateBulkMaintenanceFees as any);

export default router;
