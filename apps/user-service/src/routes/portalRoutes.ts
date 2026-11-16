import { Router } from 'express';
import { acceptPortalInvitation, getPortalInvitation, getPortalMe } from '../controllers/portalController';
import { authenticate } from '../middleware/auth';

// Osakasportaali: kutsun avaus ja hyväksyntä ovat julkisia (tunniste 192 bittiä), omat tiedot vaativat kirjautumisen.
const router = Router();
router.get('/invitations/:token', getPortalInvitation as any);
router.post('/invitations/:token/accept', acceptPortalInvitation as any);
router.get('/me', authenticate as any, getPortalMe as any);

export default router;
