import { Router } from 'express';
import { createShareholder, getShareholders, importShareholders, updateApartment } from '../controllers/shareholderController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/', authenticate as any, createShareholder as any);
router.get('/', authenticate as any, getShareholders as any);
router.post('/import', authenticate as any, importShareholders as any);
router.patch('/apartment', authenticate as any, updateApartment as any);

export default router;
