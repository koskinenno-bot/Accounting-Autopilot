import { Router } from 'express';
import * as notificationController from '../controllers/notificationController';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);

router.post('/email', notificationController.sendEmail as any);
router.get('/history', notificationController.getHistory as any);

export default router;
