import { useEffect } from 'react';
import { sendTimeHeartbeat } from '../api/accounting';

const BEAT_MS = 60_000;
const IDLE_MS = 120_000;

/**
 * Ajankäytön automaattinen mittaus: minuutin välein merkki valitulle yhtiölle, kun välilehti on näkyvissä
 * ja käyttäjä on liikuttanut hiirtä, kirjoittanut tai vierittänyt viimeisen kahden minuutin aikana.
 * Mitataan vain kirjanpitoa tekeviltä (palvelin ohittaa hallituksen ja tarkastajat).
 */
export const useActivityTracking = (companyId: string | undefined, enabled: boolean) => {
  useEffect(() => {
    if (!companyId || !enabled) return;
    let lastActivity = Date.now();
    const mark = () => { lastActivity = Date.now(); };
    const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || Date.now() - lastActivity > IDLE_MS) return;
      sendTimeHeartbeat(companyId).catch(() => { /* mittaus ei saa häiritä työtä */ });
    }, BEAT_MS);
    return () => {
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [companyId, enabled]);
};
