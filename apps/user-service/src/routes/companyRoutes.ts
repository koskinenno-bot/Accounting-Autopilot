import { Router } from 'express';
import { createCompany, getMyCompanies, getStats } from '../controllers/companyController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/', authenticate as any, createCompany as any);
router.get('/', authenticate as any, getMyCompanies as any);
router.get('/stats', authenticate as any, getStats as any);

export default router;
