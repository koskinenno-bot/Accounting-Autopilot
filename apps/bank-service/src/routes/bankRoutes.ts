import { Router } from 'express';
import multer from 'multer';
import { uploadStatement } from '../controllers/bankController';
import { requireAuth, requireCompanyAccess } from '../middleware/requireAuth';
import {
  completeConnection, listAspsps, listConnections, removeConnection, setAccountEnabled, startConnection, syncNow,
} from '../controllers/connectionController';

const router = Router();
// Tiliote: camt.053, CSV tai PDF; rajataan koko, ettei muistiin ladata valtavia tiedostoja.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
// multipart-body on luettavissa vasta multerin jälkeen
const company = requireCompanyAccess({ required: true });

router.post('/upload', requireAuth, upload.single('file'), company, uploadStatement);
// Dashboard kutsuu tätä polkua
router.post('/upload-statement', requireAuth, upload.single('file'), company, uploadStatement);

// Pankkiyhteydet (Enable Banking)
router.get('/connections', requireAuth, listConnections);
router.get('/connections/aspsps', requireAuth, listAspsps);
router.post('/connections', requireAuth, startConnection);
router.post('/connections/callback', requireAuth, completeConnection);
router.post('/connections/:id/sync', requireAuth, syncNow);
router.patch('/connections/:id/accounts/:accountId', requireAuth, setAccountEnabled);
router.delete('/connections/:id', requireAuth, removeConnection);

export default router;
