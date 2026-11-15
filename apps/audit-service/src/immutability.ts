import type { PrismaClient } from '../prisma/client';

/**
 * Tietokantatason suojaus: AuditLog-taulun rivejä ei voi muuttaa eikä poistaa (myöskään TRUNCATE),
 * vaikka sovelluksessa olisi virhe tai joku käyttäisi tietokantaa suoraan sovelluksen tunnuksilla.
 * Ajetaan palvelun käynnistyessä (idempotentti). Kirjanpitolaki 2:5a §: kirjanpidon muutokset on voitava jäljittää.
 */
export const IMMUTABILITY_SQL = [
  `CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'Muutosloki on muuttumaton: % ei ole sallittu', TG_OP;
   END;
   $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS audit_log_no_change ON "AuditLog"',
  'CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_immutable()',
  'DROP TRIGGER IF EXISTS audit_log_no_truncate ON "AuditLog"',
  'CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable()',
];

export const ensureImmutable = async (prisma: PrismaClient) => {
  try {
    await prisma.$transaction(IMMUTABILITY_SQL.map((sql) => prisma.$executeRawUnsafe(sql)));
    console.log('Muutosloki suojattu: UPDATE, DELETE ja TRUNCATE estetty tietokannassa');
  } catch (err: any) {
    console.error('VAROITUS: muutoslokin suojausta ei saatu asennettua:', err?.message);
  }
};
