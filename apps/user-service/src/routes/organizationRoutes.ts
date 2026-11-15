import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as org from '../controllers/organizationController';

const router = Router();

router.use(authenticate as any);
router.get('/me', org.getMyOrganization as any);
router.patch('/:id', org.updateOrganization as any);
router.get('/:id/members', org.listMembers as any);
router.get('/:id/users', org.listUsers as any);
router.put('/:id/users/:userId', org.updateUserAccess as any);
router.delete('/:id/users/:userId', org.removeUser as any);
router.get('/:id/invitations', org.listInvitations as any);
router.post('/:id/invitations', org.createInvitation as any);
router.delete('/:id/invitations/:invitationId', org.cancelInvitation as any);

export default router;
