import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import * as documentController from '../controllers/documentController';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage, limits: { fileSize: 25 * 1024 * 1024 } });

router.use(requireAuth);

router.post('/upload', upload.single('file'), documentController.uploadDocument as any);
router.get('/', documentController.getDocuments as any);
router.post('/:id/archive', documentController.archiveDocument as any);
router.delete('/:id', documentController.deleteDocument as any);

export default router;
