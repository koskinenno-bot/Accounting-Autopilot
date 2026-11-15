import http from 'http';
import { RequestHandler } from 'express';

/** Hop-by-hop-otsakkeet, joita ei välitetä (RFC 7230 6.1). */
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

/**
 * Yksinkertainen käänteisvälitys Python-palveluihin (raportit, tekoälyluku).
 * Polku säilyy sellaisenaan: /api/v1/reports/x -> <target>/api/v1/reports/x.
 * Mount ennen express.json-jäsennintä, jotta pyynnön runko kulkee koskemattomana.
 */
export const proxyTo = (targetBase: string, timeoutMs = 120_000): RequestHandler => {
  const target = new URL(targetBase);
  return (req, res) => {
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && v !== undefined) headers[k] = v;
    headers['x-forwarded-for'] = req.socket.remoteAddress || '';
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        method: req.method,
        path: req.originalUrl,
        headers,
        timeout: timeoutMs,
      },
      (up) => {
        const out: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(up.headers)) if (!HOP.has(k) && v !== undefined) out[k] = v;
        res.writeHead(up.statusCode || 502, out);
        up.pipe(res);
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', (err) => {
      if (res.headersSent) return res.destroy(err);
      res.status(502).json({ error: 'Palvelu ei vastaa, yritä hetken päästä uudelleen' });
    });
    req.pipe(upstream);
  };
};

/** Tarkistaa, vastaako palvelun /health (palvelimen tilasivulle). */
export const ping = (url: string, timeoutMs = 1500) =>
  new Promise<boolean>((resolve) => {
    const r = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode || 500) < 500);
    });
    r.on('timeout', () => r.destroy());
    r.on('error', () => resolve(false));
  });
