import { Router } from 'express';
import { acceptInvitation, getInvitation } from '../controllers/invitationController';

// Julkiset reitit: kutsulinkin avaaja ei ole vielä kirjautunut. Tunniste on 192-bittinen satunnaisarvo.
const router = Router();
router.get('/:token', getInvitation);
router.post('/:token/accept', acceptInvitation);

export default router;
