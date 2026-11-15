/**
 * Isännöintitoimiston ja yhtiöiden käyttöoikeudet.
 *
 * Kaksi tasoa:
 *  - Toimiston rooli (OrganizationMember.role): OWNER, ADMIN, MEMBER.
 *    OWNER ja ADMIN saavat isännöitsijän oikeudet kaikkiin toimiston yhtiöihin ja hallitsevat käyttäjiä.
 *  - Yhtiön rooli (UserCompany.role): MANAGER, ASSISTANT, BOARD, AUDITOR.
 *    Toimiston MEMBER näkee vain yhtiöt, joihin hänet on erikseen liitetty.
 *    Hallitus ja tarkastajat eivät ole toimiston jäseniä, vaan heillä on pelkkä yhtiörooli.
 *
 * Tämän tiedoston alkuosa on puhdasta logiikkaa (testattavissa ilman tietokantaa).
 */

export const ORG_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const COMPANY_ROLES = ['MANAGER', 'ASSISTANT', 'BOARD', 'AUDITOR'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  MANAGER: 'Isännöitsijä',
  ASSISTANT: 'Kirjanpitoassistentti',
  BOARD: 'Hallitus (lukuoikeus)',
  AUDITOR: 'Tilin- tai toiminnantarkastaja (lukuoikeus)',
};

export const isOrgRole = (v: unknown): v is OrgRole => typeof v === 'string' && (ORG_ROLES as readonly string[]).includes(v);
export const isCompanyRole = (v: unknown): v is CompanyRole =>
  typeof v === 'string' && (COMPANY_ROLES as readonly string[]).includes(v);

export const isOrgAdmin = (role: string | null | undefined) => role === 'OWNER' || role === 'ADMIN';

/** Saako rooli muuttaa kirjanpitoa (viennit, tositteet, laskut)? */
export const canWrite = (role: string | null | undefined) => role === 'MANAGER' || role === 'ASSISTANT';
/** Saako rooli tehdä isännöitsijän päätökset (tilikauden sulkeminen, avaussaldot, yhtiön käyttäjät)? */
export const canManage = (role: string | null | undefined) => role === 'MANAGER';

const RANK: Record<CompanyRole, number> = { AUDITOR: 1, BOARD: 1, ASSISTANT: 2, MANAGER: 3 };

/**
 * Käyttäjän tehokas rooli yhtiössä.
 * @param globalRole    JWT:n rooli (SUPER_ADMIN ja SERVICE ohittavat)
 * @param membership    UserCompany.role tai null
 * @param orgRoleInCompanyOrg  käyttäjän rooli yhtiön omistavassa toimistossa tai null
 */
export const effectiveCompanyRole = (
  globalRole: string | undefined,
  membership: string | null | undefined,
  orgRoleInCompanyOrg: string | null | undefined,
): CompanyRole | null => {
  if (globalRole === 'SUPER_ADMIN' || globalRole === 'SERVICE') return 'MANAGER';
  const candidates: CompanyRole[] = [];
  if (isCompanyRole(membership)) candidates.push(membership);
  if (isOrgAdmin(orgRoleInCompanyOrg)) candidates.push('MANAGER');
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => RANK[b] - RANK[a])[0];
};

export interface CompanyRoleInput { companyId: string; role: string }

/**
 * Tarkistaa kutsun tai käyttäjän oikeuksien syötteen.
 * Palauttaa virheviestin tai null. allowedCompanyIds = toimiston yhtiöt.
 */
export const validateAssignment = (
  orgRole: unknown,
  companyRoles: unknown,
  allowedCompanyIds: Set<string>,
): string | null => {
  if (orgRole !== null && orgRole !== undefined && !isOrgRole(orgRole)) return 'Tuntematon toimiston rooli';
  if (!Array.isArray(companyRoles)) return 'companyRoles on oltava lista';
  const seen = new Set<string>();
  for (const item of companyRoles as any[]) {
    if (!item || typeof item.companyId !== 'string') return 'Yhtiö puuttuu';
    if (!allowedCompanyIds.has(item.companyId)) return 'Yhtiö ei kuulu toimistoon';
    if (!isCompanyRole(item.role)) return `Tuntematon yhtiörooli: ${item.role}`;
    if (seen.has(item.companyId)) return 'Sama yhtiö on listassa kahdesti';
    seen.add(item.companyId);
  }
  if (!orgRole && (companyRoles as any[]).length === 0) return 'Anna toimiston rooli tai vähintään yksi yhtiö';
  return null;
};

/** Estää viimeisen omistajan poistamisen tai alentamisen. */
export const wouldRemoveLastOwner = (
  owners: string[],
  targetUserId: string,
  newOrgRole: string | null | undefined,
): boolean => owners.length === 1 && owners[0] === targetUserId && newOrgRole !== 'OWNER';

export const INVITATION_TTL_DAYS = 14;
