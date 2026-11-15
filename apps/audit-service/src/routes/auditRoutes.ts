import { Router } from 'express';
import { logEvent, getLogs, verifyLogs } from '../controllers/auditController';
import { requireAuth, requireCompanyAccess } from '../middleware/requireAuth';

const router = Router();

// Audit-loki on vain lisättävä (append-only): ei päivitys- eikä poistoreittejä (KPL 2:6 §).
// Lokin kirjoittaja (yleensä palvelu) tarkistetaan vain, jos companyId annetaan;
// luku vaatii aina yhtiön, ettei kukaan näe kaikkien yhtiöiden tapahtumia.
router.post('/log', requireAuth, requireCompanyAccess(), logEvent);
router.get('/verify', requireAuth, requireCompanyAccess({ required: true }), verifyLogs);
router.get('/logs', requireAuth, requireCompanyAccess({ required: true }), getLogs);
router.get('/', requireAuth, requireCompanyAccess({ required: true }), getLogs); // taaksepäin yhteensopiva

export default router;
