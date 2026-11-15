import { Request, Response, Router } from 'express';
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

// Pankkiyhteydet (Enable Banking). Virhe (esim. tietokanta) palautetaan vastauksena eikä kaada palvelua.
const safe = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((err) => {
    console.error('Pankkiyhteysvirhe:', err);
    if (res.headersSent) return;
    const db = /prisma|database|relation .* does not exist|Can't reach database/i.test(String(err?.message));
    res.status(500).json({
      error: db
        ? 'Pankkiyhteyksien tietokanta ei ole käytettävissä. Aja KAYNNISTA.bat uudelleen (luo kannan bank_service).'
        : `Pankkiyhteyden käsittely epäonnistui: ${err?.message || err}`,
    });
  });
};
router.get('/connections', requireAuth, safe(listConnections));
router.get('/connections/aspsps', requireAuth, safe(listAspsps));
router.post('/connections', requireAuth, safe(startConnection));
router.post('/connections/callback', requireAuth, safe(completeConnection));
router.post('/connections/:id/sync', requireAuth, safe(syncNow));
router.patch('/connections/:id/accounts/:accountId', requireAuth, safe(setAccountEnabled));
router.delete('/connections/:id', requireAuth, safe(removeConnection));

export default router;
