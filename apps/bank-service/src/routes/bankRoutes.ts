import { Router } from 'express';
import multer from 'multer';
import { uploadStatement } from '../controllers/bankController';
import { requireAuth, requireCompanyAccess } from '../middleware/requireAuth';

const router = Router();
// Tiliote: camt.053, CSV tai PDF; rajataan koko, ettei muistiin ladata valtavia tiedostoja.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
// multipart-body on luettavissa vasta multerin jälkeen
const company = requireCompanyAccess({ required: true });

router.post('/upload', requireAuth, upload.single('file'), company, uploadStatement);
// Dashboard kutsuu tätä polkua
router.post('/upload-statement', requireAuth, upload.single('file'), company, uploadStatement);

export default router;
