import { Router } from 'express';
import { createShareholder, getShareholders, importShareholders, updateApartment } from '../controllers/shareholderController';
import { authenticate } from '../middleware/auth';
import { portalStatus, sendPortalInvitations } from '../controllers/portalController';

const router = Router();

router.post('/', authenticate as any, createShareholder as any);
router.get('/', authenticate as any, getShareholders as any);
router.post('/import', authenticate as any, importShareholders as any);
router.patch('/apartment', authenticate as any, updateApartment as any);
router.get('/portal-status', authenticate as any, portalStatus as any);
router.post('/portal-invitations', authenticate as any, sendPortalInvitations as any);

export default router;
