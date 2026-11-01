import 'dotenv/config';

/**
 * JWT-salaisuus. Aiemmin oletusarvo oli 'secret', jolla kuka tahansa pystyi
 * väärentämään kirjautumistunnisteen jos .env puuttui. Tuotannossa puuttuva
 * arvo on nyt virhe; kehityksessä tulostetaan varoitus.
 */
const secret = process.env.JWT_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET puuttuu ympäristömuuttujista');
  }
  console.warn('VAROITUS: JWT_SECRET puuttuu, käytetään kehitysarvoa. Älä käytä tuotannossa.');
}
export const JWT_SECRET: string = secret || 'dev-only-insecure-secret';
