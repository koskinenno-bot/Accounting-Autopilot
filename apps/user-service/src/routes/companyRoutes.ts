import { Router } from 'express';
import { checkCompanyAccess, createCompany, getMyCompanies, getStats, updateCompany } from '../controllers/companyController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/', authenticate as any, createCompany as any);
router.get('/', authenticate as any, getMyCompanies as any);
router.get('/stats', authenticate as any, getStats as any);
router.patch('/:id', authenticate as any, updateCompany as any);
router.get('/:id/access', authenticate as any, checkCompanyAccess as any);

export default router;
