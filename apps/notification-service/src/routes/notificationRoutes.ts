import { Router } from 'express';
import * as notificationController from '../controllers/notificationController';
import { requireAuth, requireCompanyAccess } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);
const company = requireCompanyAccess({ required: true });

router.post('/email', company, notificationController.sendEmail as any);
router.get('/history', company, notificationController.getHistory as any);

export default router;
