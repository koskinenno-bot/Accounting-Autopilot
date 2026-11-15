import { Router } from 'express';
import * as authController from '../controllers/authController';
import * as passwordReset from '../controllers/passwordResetController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/password-reset', passwordReset.requestReset);
router.get('/password-reset/:token', passwordReset.checkReset);
router.post('/password-reset/confirm', passwordReset.confirmReset);
router.post('/logout-all', authenticate as any, authController.logoutAll);
router.post('/change-password', authenticate as any, passwordReset.changePassword);
// MFA-toiminnot olivat toteutettu mutta reitittämättä
router.post('/mfa/setup', authenticate as any, authController.setupMFA);
router.post('/mfa/verify', authenticate as any, authController.verifyMFA);

export default router;
