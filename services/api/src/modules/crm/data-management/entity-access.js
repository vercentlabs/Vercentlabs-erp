// The one parent-record access check for record-attached content (Timeline,
// Notes, governed attachments, custom-field values, tags, email lists): the
// same owner rule and entity-type-specific
// sensitive-content permission each record type's own detail view enforces.

import { crmContactVisibleSql, crmOwnerScopeSql } from "./crm-access-scope.js";
import { CrmError } from "./errors.js";
import { canViewSensitiveLeadContent, leadScopeSql } from "../leads/access.js";
import { accountCan, accountScopeSql } from "../accounts/access.js";
import { ACCOUNT_PERMISSIONS } from "../accounts/constants.js";
import { canViewSensitiveContactContent } from "../master-data/contact-security.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);

// Resolves whether the caller may see this record's related content at
// all — the same owner scope + entity-type-specific sensitive
// permission every existing detail-data function already enforces, not a
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
    const result = await client.query(
      `SELECT lead.id FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.id=$2 AND lead.archived_at IS NULL${scope} LIMIT 1`,
      values,
    );
    return Boolean(result.rows[0]);
  }
  if (entityType === "opportunity") {
    if (!canViewSensitiveLeadContent(context)) return false; // established reuse — see opportunity-detail-data.ts
    // F028 — owner scope, matching recordScope() for opportunity lists: a
    // caller without view-all reaches only their own or unowned deals, so a
    // deal id they cannot list cannot be read or written through here.
    const opportunityValues = [context.organizationId, entityId];
    const result = await client.query(
      `SELECT opportunity.id FROM tenant.crm_opportunities opportunity
        WHERE opportunity.organization_id=$1 AND opportunity.id=$2 AND opportunity.status <> 'archived'
         ${crmOwnerScopeSql(context, (value) => { opportunityValues.push(value); return `$${opportunityValues.length}`; }, "opportunity.owner_user_id", "opportunity.organization_id", { resource: "opportunities", alias: "opportunity" })} LIMIT 1`,
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
    if (!canViewSensitiveContactContent(context)) return false;
    const values = [context.organizationId, entityId];
    const result = await client.query(
      `SELECT contact.id FROM tenant.contacts contact LEFT JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id WHERE contact.organization_id=$1 AND contact.id=$2 AND contact.status='active' AND (party.id IS NULL OR party.status='active')${crmContactVisibleSql(context, (value) => add(values, value), "contact", "party")} LIMIT 1`,
      values,
    );
    return Boolean(result.rows[0]);
  }
  // Campaigns carry no dedicated sensitive-content permission today (no
  // personal/contact data of their own) — ordinary crm.view is the same bar
  // every other non-sensitive CRM resource uses.
  const result = await client.query(
    `SELECT id FROM tenant.crm_campaigns WHERE organization_id=$1 AND id=$2 AND status <> 'cancelled' LIMIT 1`,
    [context.organizationId, entityId],
  );
  return Boolean(result.rows[0]);
}

function add(values, value) { values.push(value); return `$${values.length}`; }
