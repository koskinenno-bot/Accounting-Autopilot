import { Router } from 'express';
import * as invoiceController from '../controllers/invoiceController';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);

router.post('/', invoiceController.createInvoice as any);
router.get('/', invoiceController.getInvoices as any);
router.get('/:id/xml', invoiceController.getFinvoiceXml as any);
router.post('/bulk-maintenance-fees', invoiceController.generateBulkMaintenanceFees as any);

export default router;
