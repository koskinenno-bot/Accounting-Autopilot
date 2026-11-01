import { Router } from 'express';
import multer from 'multer';
import { uploadStatement } from '../controllers/bankController';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
// Tiliote on XML-tiedosto; rajataan koko, ettei muistiin ladata valtavia tiedostoja.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/upload', requireAuth, upload.single('file'), uploadStatement);
// Dashboard kutsuu tätä polkua
router.post('/upload-statement', requireAuth, upload.single('file'), uploadStatement);

export default router;
