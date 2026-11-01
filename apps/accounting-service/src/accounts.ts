/**
 * Järjestelmän automaattikirjauksissa käytettävät tilit.
 * Pidä nämä synkronissa services/chartOfAccountsService.ts:n TATO_TEMPLATE-listan kanssa,
 * muuten kirjaukset kaatuvat viite-eheysvirheeseen (tiliä ei ole olemassa).
 */
export const ACCOUNTS = {
  BANK: '1900',            // Pankkitili 1
  RECEIVABLES: '1700',     // Myyntisaamiset (vastikesaamiset)
  SUSPENSE: '1990',        // Selvitettävät erät
  PAYABLES: '2800',        // Ostovelat
  MAINTENANCE_FEES: '3000' // Hoitovastikkeet
} as const;
