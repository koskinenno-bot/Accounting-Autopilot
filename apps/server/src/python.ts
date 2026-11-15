import { ChildProcess, spawn } from 'child_process';
import path from 'path';

/**
 * Python-palvelut (raportointi 3006, tekoälyluku 8001) käynnistetään palvelimen lapsiprosesseina,
 * jotta koko järjestelmä lähtee yhdellä komennolla. Ne kuuntelevat vain 127.0.0.1:ssä;
 * selain tavoittaa ne palvelimen välityksen kautta (/api/v1/reports, /api/v1/ml).
 * PYTHON_SERVICES=off jättää ne käynnistämättä (esim. jos ne ajetaan erikseen).
 */
export interface PythonService { name: string; dir: string; port: number }

export const PYTHON_SERVICES: PythonService[] = [
  { name: 'reporting-service', dir: 'reporting-service', port: 3006 },
  { name: 'ml-service', dir: 'ml-service', port: 8001 },
];

const children = new Set<ChildProcess>();
let stopping = false;

export const startPython = (appsDir: string, svc: PythonService, attempt = 0) => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const env = { ...process.env, PORT: String(svc.port), HOST: '127.0.0.1', PYTHONUNBUFFERED: '1' };
  const child = spawn(python, ['main.py'], { cwd: path.join(appsDir, svc.dir, 'src'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const prefix = (line: string) => line && console.log(`[${svc.name}] ${line}`);
  child.stdout?.on('data', (d) => String(d).split(/\r?\n/).forEach(prefix));
  child.stderr?.on('data', (d) => String(d).split(/\r?\n/).forEach(prefix));
  const startedAt = Date.now();
  child.on('error', (err) => console.error(`[${svc.name}] käynnistys epäonnistui (${python}): ${err.message}`));
  child.on('exit', (code) => {
    children.delete(child);
    if (stopping) return;
    // Pitkään toiminut prosessi aloittaa viiveet alusta; muuten 2, 4, 8 ... enintään 60 s
    const next = Date.now() - startedAt > 60_000 ? 0 : attempt + 1;
    const delay = Math.min(60_000, 2000 * 2 ** next);
    console.error(`[${svc.name}] pysähtyi (koodi ${code}), uusi yritys ${Math.round(delay / 1000)} s kuluttua`);
    setTimeout(() => startPython(appsDir, svc, next), delay).unref();
  });
};

export const stopPython = () => {
  stopping = true;
  for (const c of children) c.kill();
};
