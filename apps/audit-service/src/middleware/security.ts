/**
 * Yhteiset HTTP-suojaukset kaikille Node-palveluille.
 *
 * TÄMÄ ON KANONINEN VERSIO. Kopio palveluihin polkuun src/middleware/security.ts:
 *   node scripts/sync-auth.js
 */
import { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';
import cors from 'cors';

/**
 * CORS: sallitut osoitteet ympäristömuuttujasta CORS_ORIGINS (pilkuilla eroteltu).
 * Kehityksessä oletuksena dashboardin osoitteet; tuotannossa ilman asetusta sallitaan vain sama osoite.
 */
export const corsMiddleware = (): RequestHandler => {
  const configured = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const dev = process.env.NODE_ENV !== 'production';
  const allowed = configured.length ? configured : dev ? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'] : [];
  return cors({
    origin: (origin, cb) => {
      // Ei Origin-otsaketta = sama osoite, palvelukutsu tai komentorivi
      if (!origin || allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });
};

/** Perussuojaotsakkeet (vastaa helmetin oleellisia oletuksia rajapinnoille). */
export const securityHeaders: RequestHandler = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
};

/**
 * Viimeinen virheenkäsittelijä: virheellinen JSON = 400, liian suuri pyyntö = 413, muut 500 ilman
 * pinojälkeä tai sisäisiä tietoja (Expressin oletus näyttää pinon kehitystilassa HTML:nä).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err?.status || err?.statusCode;
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Virheellinen JSON-sisältö' });
  if (err?.type === 'entity.too.large' || status === 413) return res.status(413).json({ error: 'Pyyntö on liian suuri' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Tiedosto on liian suuri' });
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return res.status(status).json({ error: err.expose && err.message ? err.message : 'Virheellinen pyyntö' });
  }
  console.error(`Käsittelemätön virhe ${req.method} ${req.originalUrl}:`, err?.stack || err);
  if (res.headersSent) return;
  return res.status(500).json({ error: 'Palvelussa tapahtui virhe. Yritä uudelleen.' });
};

/** Tuntematon reitti JSONina. */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Reittiä ei löydy: ${req.method} ${req.path}` });
};
