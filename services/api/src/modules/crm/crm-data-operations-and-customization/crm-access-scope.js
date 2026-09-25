import { CrmError } from "./errors.js";

// The one CRM record-ownership rule, shared by every list, count, export,
// report and single-record check so they can never disagree:
//
//   • organisation owner / crm.records.view_all (CRM Administrator, Sales
//     Head, Sales Operations, …) — every record in the caller's company/
//     branch scope (that outer boundary is applied separately, always);
//   • everyone else — records they own, records owned by ACTIVE members of
//     an ACTIVE Sales Team they manage (crm_sales_teams.manager_user_id —
//     the existing F020 hierarchy, never a second team system), and
//     unassigned records (owner IS NULL: the shared intake queue new Leads
//     wait in when no assignment rule or fallback owner applies).
//
// "Manages a team" is structural data, not a role name: a Sales Manager
// sees their team because they are the team's manager, and a Sales
// Representative who manages no team sees only their own records.

export function canViewAllCrmRecords(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("crm.records.view_all"))
  );
}

// Resource-specific visibility. crm.records.view_all stays the umbrella
// (every CRM resource); a resource permission bypasses ownership for THAT
// resource only — crm.leads.view_all never widens Opportunities, Accounts
// or Activities. Only resources with a real consumer have one (Marketing
// works every Lead). A call site that does not name its resource gets the
// umbrella rule only (fail closed).
export const CRM_RESOURCE_VIEW_ALL_PERMISSIONS = Object.freeze({
  leads: "crm.leads.view_all",
});

// Relationship grants (read visibility beyond owner/team, never beyond the
// company boundary), expressed through existing data rather than a new
// sharing model:
//   crm.customers.view_all — every CUSTOMER Account (party_type customer /
//     both, not prospects), its Contacts, and the Activities logged on them
//     (Customer Success);
//   crm.partners.manage — Leads/Opportunities registered as partner deals
//     (crm_partner_deals), the Activities logged on those Opportunities,
//     and the Accounts behind partners and those deals (Partner Manager).
export const CRM_CUSTOMERS_VIEW_ALL = "crm.customers.view_all";
export const CRM_PARTNER_RELATIONSHIP_PERMISSION = "crm.partners.manage";

function holds(context, key) {
  return Boolean(context.permissions?.includes(key));
}

// Reading someone else's PRIVATE note/communication, or any shared inbox, is
// CRM administration — not a consequence of broad READ visibility. Record
// breadth (crm.records.view_all, e.g. Auditor / Read-only) no longer implies
// it: organisation owner, or umbrella visibility together with
// crm.settings.manage (CRM Administrator, Sales Operations, System Admin).
export function canOverridePrivateCrmContent(context) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || (canViewAllCrmRecords(context) && holds(context, "crm.settings.manage"));
}

// Writing a note or file on a record is changing that record's dossier, so
// seeing a record (e.g. Auditor / Read-only company-wide read) is never
// enough: the caller must manage that kind of record, or log CRM work
// (crm.activities.manage).
const CONTENT_WRITE_PERMISSION = Object.freeze({
  lead: "crm.leads.manage",
  opportunity: "crm.opportunities.manage",
  party: "crm.accounts.manage",
  contact: "crm.accounts.manage",
  campaign: "crm.campaigns.manage",
});

export function assertCanWriteCrmRecordContent(context, entityType) {
  if (context.roleSlugs?.includes("organization_owner")) return;
  const key = CONTENT_WRITE_PERMISSION[entityType];
  if ((key && holds(context, key)) || holds(context, "crm.activities.manage")) return;
  throw new CrmError(403, "You do not have permission to add or change notes and files on this record.", "CRM_RECORD_CONTENT_WRITE_FORBIDDEN");
}

export function canViewAllCrmResource(context, resource) {
  if (canViewAllCrmRecords(context)) return true;
  const key = CRM_RESOURCE_VIEW_ALL_PERMISSIONS[resource];
  return Boolean(key && holds(context, key));
}

const CUSTOMER_PARTY_TYPES = "('customer','both')";

// Extra OR-branches a restricted caller gets for `resource` rows aliased
// `alias` (SQL only; one EXISTS per grant, no per-row queries).
export function relationshipGrantSql(context, resource, alias, organizationExpr) {
  if (!alias) return [];
  const grants = [];
  if (holds(context, CRM_PARTNER_RELATIONSHIP_PERMISSION) && (resource === "leads" || resource === "opportunities")) {
    const column = resource === "leads" ? "lead_id" : "opportunity_id";
    grants.push(`EXISTS (SELECT 1 FROM tenant.crm_partner_deals partner_deal WHERE partner_deal.organization_id=${organizationExpr} AND partner_deal.${column}=${alias}.id)`);
  }
  // Parent-record rule: an Activity logged directly on a partner-registered
  // Opportunity is visible exactly when that Opportunity is (never others).
  if (holds(context, CRM_PARTNER_RELATIONSHIP_PERMISSION) && resource === "activities") {
    grants.push(`(${alias}.entity_type='opportunity' AND EXISTS (SELECT 1 FROM tenant.crm_partner_deals partner_deal WHERE partner_deal.organization_id=${organizationExpr} AND partner_deal.opportunity_id=${alias}.entity_id))`);
  }
  if (holds(context, CRM_CUSTOMERS_VIEW_ALL) && resource === "activities") {
    grants.push(`((${alias}.entity_type='party' AND EXISTS (SELECT 1 FROM tenant.business_parties customer_party WHERE customer_party.organization_id=${organizationExpr} AND customer_party.id=${alias}.entity_id AND customer_party.party_type IN ${CUSTOMER_PARTY_TYPES}))
      OR (${alias}.entity_type='contact' AND EXISTS (SELECT 1 FROM tenant.contacts customer_contact JOIN tenant.business_parties customer_party ON customer_party.organization_id=customer_contact.organization_id AND customer_party.id=customer_contact.party_id WHERE customer_contact.organization_id=${organizationExpr} AND customer_contact.id=${alias}.entity_id AND customer_party.party_type IN ${CUSTOMER_PARTY_TYPES})))`);
  }
  return grants;
}

// SQL: the owner is an active member of an active team the caller manages.
// Uses crm_sales_team_members_user_idx (organization_id,user_id,status) and
// crm_sales_teams_manager_idx (migration 180).
export function managedTeamMemberSql(bind, context, ownerExpr, organizationExpr, managerExpr = null) {
  return `EXISTS (SELECT 1 FROM tenant.crm_sales_team_members team_member
      JOIN tenant.crm_sales_teams managed_team
        ON managed_team.organization_id=team_member.organization_id AND managed_team.id=team_member.team_id
     WHERE team_member.organization_id=${organizationExpr} AND team_member.user_id=${ownerExpr}
       AND team_member.status='active' AND team_member.effective_from<=current_date
       AND (team_member.effective_to IS NULL OR team_member.effective_to>=current_date)
       AND managed_team.status='active' AND managed_team.manager_user_id=${managerExpr ?? bind(context.userId)})`;
}

// Returns "" for view-all callers, else " AND (…)". `bind(value)` adds a
// query parameter and returns its placeholder ($n) — every module keeps its
// own parameter array, so the helper never assumes one.
//   includeUnassigned: false  → owned/team records only (e.g. mutations that
//                               must never touch the shared queue).
//   context.ownRecordsOnly     → "mine, full stop" views (My Follow-ups):
//                               no team, no queue broadening.
//   resource ("leads" | "opportunities" | "activities" | …) → which
//                               resource-specific view-all applies;
//   alias                      → row alias, enables relationship grants.
export function crmOwnerScopeSql(context, bind, ownerExpr, organizationExpr, { includeUnassigned = true, resource = null, alias = null } = {}) {
  if (canViewAllCrmResource(context, resource) && !context.ownRecordsOnly) return "";
  const me = bind(context.userId);
  const parts = [`${ownerExpr} = ${me}`];
  if (includeUnassigned && !context.ownRecordsOnly) parts.unshift(`${ownerExpr} IS NULL`);
  if (!context.ownRecordsOnly) {
    parts.push(managedTeamMemberSql(bind, context, ownerExpr, organizationExpr, me));
    parts.push(...relationshipGrantSql(context, resource, alias, organizationExpr));
  }
  return ` AND (${parts.join(" OR ")})`;
}

// For the few call sites that decide on an already-loaded row in JS.
export async function managedTeamMemberIds(client, context) {
  const { rows } = await client.query(
    `SELECT DISTINCT team_member.user_id FROM tenant.crm_sales_team_members team_member
       JOIN tenant.crm_sales_teams managed_team ON managed_team.organization_id=team_member.organization_id AND managed_team.id=team_member.team_id
      WHERE team_member.organization_id=$1 AND managed_team.manager_user_id=$2 AND managed_team.status='active'
        AND team_member.status='active' AND team_member.effective_from<=current_date
        AND (team_member.effective_to IS NULL OR team_member.effective_to>=current_date)`,
    [context.organizationId, context.userId],
  );
  return new Set(rows.map((row) => String(row.user_id)));
}

export async function canAccessOwnedRecord(client, context, ownerUserId, { includeUnassigned = true, resource = null } = {}) {
  if (canViewAllCrmResource(context, resource)) return true;
  if (!ownerUserId) return includeUnassigned;
  if (String(ownerUserId) === String(context.userId)) return true;
  return (await managedTeamMemberIds(client, context)).has(String(ownerUserId));
}

// Who may a record be given to? view-all callers: anyone (the user must
// still be an eligible member — checked by the existing validators);
// others: themselves, or an active member of a team they manage. Keeps a
// Sales Representative from handing records to arbitrary users and lets a
// Sales Manager distribute work inside their own team only.
export async function assertCrmOwnerAssignable(client, context, requestedUserId, message = "You can only assign records to yourself or to members of a team you manage.", { resource = null } = {}) {
  if (!requestedUserId || String(requestedUserId) === String(context.userId)) return;
  if (canViewAllCrmResource(context, resource)) return;
  if ((await managedTeamMemberIds(client, context)).has(String(requestedUserId))) return;
  throw new CrmError(403, message, "CRM_OWNER_ASSIGNMENT_FORBIDDEN");
}

// Account access (business_parties.owner_user_id, migration 180). NULL
// owner = a shared Account (every pre-existing Account; ownership is never
// fabricated). A restricted caller sees shared Accounts, Accounts they or
// their managed team own, and Accounts on which they or their team own an
// Opportunity (so a rep can always open the customer behind their deal).
// The company boundary is applied separately by each caller, as for records.
export function crmAccountAccessSql(context, bind, accountAlias) {
  if (canViewAllCrmRecords(context)) return "";
  const me = bind(context.userId);
  const organization = `${accountAlias}.organization_id`;
  const grants = [];
  if (holds(context, CRM_CUSTOMERS_VIEW_ALL)) grants.push(`${accountAlias}.party_type IN ${CUSTOMER_PARTY_TYPES}`);
  if (holds(context, CRM_PARTNER_RELATIONSHIP_PERMISSION))
    grants.push(
      `EXISTS (SELECT 1 FROM tenant.crm_partner_accounts partner_account WHERE partner_account.organization_id=${organization} AND partner_account.party_id=${accountAlias}.id)`,
      `EXISTS (SELECT 1 FROM tenant.crm_partner_deals partner_deal JOIN tenant.crm_opportunities partner_opportunity ON partner_opportunity.organization_id=partner_deal.organization_id AND partner_opportunity.id=partner_deal.opportunity_id WHERE partner_deal.organization_id=${organization} AND partner_opportunity.party_id=${accountAlias}.id)`,
    );
  return ` AND (${accountAlias}.owner_user_id IS NULL OR ${accountAlias}.owner_user_id = ${me}
    OR ${managedTeamMemberSql(bind, context, `${accountAlias}.owner_user_id`, organization, me)}
    OR EXISTS (SELECT 1 FROM tenant.crm_opportunities account_opportunity
      WHERE account_opportunity.organization_id=${organization} AND account_opportunity.party_id=${accountAlias}.id
        AND (account_opportunity.owner_user_id = ${me}
          OR ${managedTeamMemberSql(bind, context, "account_opportunity.owner_user_id", "account_opportunity.organization_id", me)}))${grants.map((grant) => `\n    OR ${grant}`).join("")})`;
}

// Contact access inherits Account access. A standalone Contact (no Account)
// has no company or owner of its own, so it is visible to view-all callers,
// its creator, and the creator's sales-team manager — never to everyone.
export function crmContactAccessSql(context, bind, contactAlias, accountAlias) {
  if (canViewAllCrmRecords(context)) return "";
  const me = bind(context.userId);
  const accountAccess = crmAccountAccessSql(context, bind, accountAlias).replace(/^ AND /, "");
  return ` AND ((${contactAlias}.party_id IS NOT NULL AND ${accountAccess})
    OR (${contactAlias}.party_id IS NULL AND (${contactAlias}.created_by = ${me}
      OR ${managedTeamMemberSql(bind, context, `${contactAlias}.created_by`, `${contactAlias}.organization_id`, me)})))`;
}

// The full "may this caller see this Account / Contact" predicate: the
// company boundary FIRST (always ANDed — ownership, team membership or a
// linked deal can never cross it), then the ownership rule above. Every
// Account/Contact read (lists, detail, 360, hierarchy, merge, relationship
// lists, pickers) uses these, so there is one definition.
// Company boundary alone (no ownership) — for org-wide integrity checks
// that must stay inside the caller's companies (e.g. conversion reuse).
export function crmAccountCompanySql(context, bind, accountAlias) {
  if (context.activeCompanyId)
    return ` AND (${accountAlias}.company_id IS NULL OR ${accountAlias}.company_id = ${bind(context.activeCompanyId)})`;
  return context.allowAllCompanies ? "" : " AND false";
}

export function crmAccountVisibleSql(context, bind, accountAlias) {
  const company = crmAccountCompanySql(context, bind, accountAlias);
  return company === " AND false" ? company : `${company}${crmAccountAccessSql(context, bind, accountAlias)}`;
}

// accountAlias must be LEFT JOINed on contact.party_id (NULL for standalone).
export function crmContactVisibleSql(context, bind, contactAlias, accountAlias) {
  if (context.activeCompanyId)
    return ` AND (${contactAlias}.party_id IS NULL OR ${accountAlias}.company_id IS NULL OR ${accountAlias}.company_id = ${bind(context.activeCompanyId)})${crmContactAccessSql(context, bind, contactAlias, accountAlias)}`;
  return context.allowAllCompanies ? crmContactAccessSql(context, bind, contactAlias, accountAlias) : " AND false";
}
