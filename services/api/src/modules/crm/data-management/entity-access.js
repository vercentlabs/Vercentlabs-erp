// The one parent-record access check for record-attached content (Timeline,
// Notes, governed attachments): the
// same owner rule and entity-type-specific
// sensitive-content permission each record type's own detail view enforces.

import { CrmError } from "./errors.js";
import { canViewSensitiveLeadContent, leadScopeSql } from "../leads/access.js";
import { accountCan, accountScopeSql } from "../accounts/access.js";
import { ACCOUNT_PERMISSIONS } from "../accounts/constants.js";
import { contactCan, contactScopeSql } from "../contacts/access.js";
import { CONTACT_PERMISSIONS } from "../contacts/constants.js";
import { opportunityCan, opportunityScopeSql } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact"]);

// Resolves whether the caller may see this record's related content at
// all — the same scope + permission the record's own detail page enforces, not a
// re-derived equivalent. Returns null (no crash, no partial leak) for "no
// access," which callers must treat as an empty timeline, never an error
// that could distinguish "record doesn't exist" from "record exists but
// you can't see it."
// Exported so other CRM activity domain modules that operate against the
// same 5 entity types (Notes, governed attachments) reuse this ONE
// authorization implementation rather than re-deriving an equivalent one —
// see notes.js's own import of this function.
export async function resolveCrmEntityAccess(client, context, entityType, entityId) {
  if (!ENTITY_TYPES.has(entityType)) throw new CrmError(400, "Unsupported timeline entity type.", "CRM_TIMELINE_ENTITY_INVALID");
  if (!UUID.test(String(entityId || ""))) throw new CrmError(400, "A valid record id is required.", "CRM_TIMELINE_ENTITY_INVALID");
  if (entityType === "lead") {
    if (!canViewSensitiveLeadContent(context)) return false;
    const values = [context.organizationId, entityId];
    const scope = leadScopeSql(context, values, "lead");
    // Archived leads included: the lead page opens them (getLead), so their history must show too.
    const result = await client.query(
      `SELECT lead.id FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.id=$2${scope} LIMIT 1`,
      values,
    );
    return Boolean(result.rows[0]);
  }
  if (entityType === "opportunity") {
    // Exactly the deal page's rule (getOpportunity): the deal view permission and the deal's own Own / Team / All scope — a deal
    // seen through its team shows its history, and an archived deal (archived_at) still opens with it.
    if (!opportunityCan(context, OPPORTUNITY_PERMISSIONS.view)) return false;
    const opportunityValues = [context.organizationId, entityId];
    const result = await client.query(
      `SELECT opportunity.id FROM tenant.crm_opportunities opportunity
        WHERE opportunity.organization_id=$1 AND opportunity.id=$2${opportunityScopeSql(context, opportunityValues, "opportunity")} LIMIT 1`,
      opportunityValues,
    );
    return Boolean(result.rows[0]);
  }
  // Account/Contact: the same ownership rule as their own lists
  // (crm-access-scope.js).
  if (entityType === "party") {
    if (!accountCan(context, ACCOUNT_PERMISSIONS.view)) return false;
    const values = [context.organizationId, entityId];
    const result = await client.query(
      `SELECT account.id FROM tenant.business_parties account WHERE account.organization_id=$1 AND account.id=$2 AND account.party_type <> 'supplier'${accountScopeSql(context, values, "account")} LIMIT 1`,
      values,
    );
    return Boolean(result.rows[0]);
  }
  if (entityType === "contact") {
    if (!contactCan(context, CONTACT_PERMISSIONS.view)) return false;
    const values = [context.organizationId, entityId];
    const result = await client.query(
      `SELECT contact.id FROM tenant.contacts contact WHERE contact.organization_id=$1 AND contact.id=$2${contactScopeSql(context, (value) => add(values, value), "contact")} LIMIT 1`,
      values,
    );
    return Boolean(result.rows[0]);
  }
  return false;
}

function add(values, value) { values.push(value); return `$${values.length}`; }
