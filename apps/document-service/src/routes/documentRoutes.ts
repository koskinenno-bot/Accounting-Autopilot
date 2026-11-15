import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import * as documentController from '../controllers/documentController';
import { UPLOAD_DIR } from '../controllers/documentController';
import { requireAuth, requireCompanyAccess } from '../middleware/requireAuth';

const router = Router();

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage, limits: { fileSize: 25 * 1024 * 1024 } });

router.use(requireAuth);

const company = requireCompanyAccess({ required: true });

// :id-reitit tarkistavat dokumentin yhtiön käsittelijässä
router.post('/upload', upload.single('file'), company, documentController.uploadDocument as any);
router.get('/', company, documentController.getDocuments as any);
router.post('/closing-archive', documentController.archiveClosing as any);
router.get('/:id/download', documentController.downloadDocument as any);
router.post('/:id/archive', documentController.archiveDocument as any);
router.delete('/:id', documentController.deleteDocument as any);

export default router;
