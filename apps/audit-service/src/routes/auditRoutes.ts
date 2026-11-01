import { Router } from 'express';
import { logEvent, getLogs } from '../controllers/auditController';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// Audit-loki on vain lisättävä (append-only): ei päivitys- eikä poistoreittejä (KPL 2:6 §).
router.post('/log', requireAuth, logEvent);
router.get('/logs', requireAuth, getLogs);
router.get('/', requireAuth, getLogs); // taaksepäin yhteensopiva

export default router;
