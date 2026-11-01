import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
// MFA-toiminnot olivat toteutettu mutta reitittämättä
router.post('/mfa/setup', authenticate as any, authController.setupMFA);
router.post('/mfa/verify', authenticate as any, authController.verifyMFA);

export default router;
