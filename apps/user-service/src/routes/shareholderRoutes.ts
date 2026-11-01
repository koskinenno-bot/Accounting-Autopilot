import { Router } from 'express';
import { createShareholder, getShareholders } from '../controllers/shareholderController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/', authenticate as any, createShareholder as any);
router.get('/', authenticate as any, getShareholders as any);

export default router;
