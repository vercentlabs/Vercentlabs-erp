// F003 gap-closure (benchmark: "Contact management in top ERPs" report) —
// crm_opportunities.contact_id was always a single-Contact pointer, the one
// architectural gap Vercentlabs shared only with Odoo among the 7 platforms
// studied (Salesforce's OpportunityContactRole, SAP's Buying Center,
// NetSuite's shared Contact Role subtab, Dynamics' Stakeholders, and Zoho's
// Contact Roles all let multiple Contacts attach to one deal, each with a
// role). tenant.crm_opportunity_contact_roles (migration 165) is additive —
// crm_opportunities.contact_id remains the fast "primary contact" pointer
// every existing caller (list/detail queries, reporting) already reads, and
// is kept in sync with this table's is_primary=true row here, mirroring the
// exact precedent contact-relationships.js set for Contact<->Account.
import { CrmError, queueOutboxEvent, text, camelize, requireOpportunityInScope } from "./shared.js";
import { crmChildScopes } from "../crm-data-operations-and-customization/record-policy.js";
import { getCrmContact } from "../prospect-and-relationship-master-data/contact-operations.js";

// Same vocabulary as tenant.crm_contact_account_relationships.stakeholder_role
// and tenant.crm_account_stakeholders.stakeholder_role — a deliberate
// consistency choice (same business concept: this person's function in a
// relationship/deal), not a shared import: opportunity-and-pipeline-
// governance and prospect-and-relationship-master-data are separate CRM
// capabilities that do not import each other's internals (see
// verify-crm-module-contracts.mjs's capability boundaries). The DB CHECK
// constraint on both tables is the actual source of truth against drift.
export const OPPORTUNITY_CONTACT_ROLES = Object.freeze([
  "economic_buyer",
  "decision_maker",
  "champion",
  "influencer",
  "user",
  "blocker",
  "procurement",
  "legal",
  "technical",
  "other",
]);

async function assertContactBelongsToOpportunityAccount(client, context, contactId, partyId) {
  if (!partyId) return;
  const result = await client.query(
    `SELECT 1 FROM tenant.contacts c
      WHERE c.organization_id=$1 AND c.id=$2 AND c.party_id=$3
     UNION ALL
     SELECT 1 FROM tenant.crm_contact_account_relationships r
      WHERE r.organization_id=$1 AND r.contact_id=$2 AND r.party_id=$3 AND r.status='active'
     LIMIT 1`,
    [context.organizationId, contactId, partyId],
  );
  if (!result.rows[0]) {
    throw new CrmError(
      409,
      "This Contact is not related to the Opportunity's Account.",
      "CRM_OPPORTUNITY_CONTACT_ROLE_ACCOUNT_MISMATCH",
    );
  }
}

// Keeps crm_opportunities.contact_id (the fast, backward-compatible primary
// pointer every pre-existing caller reads) mirrored to whichever role row is
// is_primary=true here. Idempotent — safe to call after every mutation.
async function syncPrimaryOpportunityContactPointer(client, context, opportunityId) {
  const primary = await client.query(
    `SELECT contact_id FROM tenant.crm_opportunity_contact_roles
     WHERE organization_id=$1 AND opportunity_id=$2 AND is_primary=true AND status='active'
     LIMIT 1`,
    [context.organizationId, opportunityId],
  );
  await client.query(
    `UPDATE tenant.crm_opportunities SET contact_id=$3, updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND contact_id IS DISTINCT FROM $3`,
    [context.organizationId, opportunityId, primary.rows[0]?.contact_id ?? null],
  );
}

export async function listOpportunityContactRoles(client, context, opportunityId) {
  await requireOpportunityInScope(client, context, opportunityId, { lock: false });
  const result = await client.query(
    `SELECT ocr.*, contact.first_name, contact.last_name, contact.designation, contact.status AS contact_status
       FROM tenant.crm_opportunity_contact_roles ocr
       JOIN tenant.contacts contact ON contact.organization_id=ocr.organization_id AND contact.id=ocr.contact_id
      WHERE ocr.organization_id=$1 AND ocr.opportunity_id=$2 AND ocr.status='active'
      ORDER BY ocr.is_primary DESC, contact.first_name, contact.last_name`,
    [context.organizationId, opportunityId],
  );
  return result.rows.map(camelize);
}

export async function addOpportunityContactRole(client, context, opportunityId, input = {}) {
  const opportunity = await requireOpportunityInScope(client, context, opportunityId);
  const contactId = text(input.contactId);
  if (!contactId) throw new CrmError(400, "Choose a Contact.", "CRM_OPPORTUNITY_CONTACT_ROLE_CONTACT_REQUIRED");
  const contactResult = await client.query(
    `SELECT id, status FROM tenant.contacts WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, contactId],
  );
  if (!contactResult.rows[0] || contactResult.rows[0].status !== "active") {
    throw new CrmError(404, "Select an active Contact.", "CRM_OPPORTUNITY_CONTACT_ROLE_CONTACT_NOT_FOUND");
  }
  await assertContactBelongsToOpportunityAccount(client, context, contactId, opportunity.partyId);
  const role = input.role ? text(input.role) : null;
  if (role && !OPPORTUNITY_CONTACT_ROLES.includes(role)) {
    throw new CrmError(400, "Choose a valid role.", "CRM_OPPORTUNITY_CONTACT_ROLE_INVALID", {
      errors: { role: ["Choose a valid role."] },
    });
  }
  const notes = text(input.notes) || null;
  const existing = await client.query(
    `SELECT id FROM tenant.crm_opportunity_contact_roles WHERE organization_id=$1 AND opportunity_id=$2 AND contact_id=$3`,
    [context.organizationId, opportunityId, contactId],
  );
  if (existing.rows[0]) {
    throw new CrmError(409, "This Contact already has a role on this Opportunity.", "CRM_OPPORTUNITY_CONTACT_ROLE_ALREADY_EXISTS");
  }
  const isFirst = await client.query(
    `SELECT 1 FROM tenant.crm_opportunity_contact_roles WHERE organization_id=$1 AND opportunity_id=$2 AND status='active' LIMIT 1`,
    [context.organizationId, opportunityId],
  );
  const isPrimary = Boolean(input.isPrimary) || !isFirst.rows[0];
  if (isPrimary) {
    await client.query(
      `UPDATE tenant.crm_opportunity_contact_roles
       SET is_primary=false, updated_by=$3, updated_at=now()
       WHERE organization_id=$1 AND opportunity_id=$2 AND is_primary=true AND status='active'`,
      [context.organizationId, opportunityId, context.userId],
    );
  }
  const inserted = await client.query(
    `INSERT INTO tenant.crm_opportunity_contact_roles
       (organization_id, opportunity_id, contact_id, role, is_primary, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     RETURNING id`,
    [context.organizationId, opportunityId, contactId, role, isPrimary, notes, context.userId],
  );
  if (isPrimary) await syncPrimaryOpportunityContactPointer(client, context, opportunityId);
  await queueOutboxEvent(client, context, "crm.opportunity_contact_role.added", "opportunity", opportunityId, {
    opportunityContactRoleId: inserted.rows[0].id,
    contactId,
    role,
    isPrimary,
  });
  return listOpportunityContactRoles(client, context, opportunityId);
}

export async function updateOpportunityContactRole(client, context, opportunityId, roleId, input = {}) {
  await requireOpportunityInScope(client, context, opportunityId, { lock: false });
  const id = text(roleId);
  const existing = await client.query(
    `SELECT * FROM tenant.crm_opportunity_contact_roles WHERE organization_id=$1 AND id=$2 AND opportunity_id=$3 AND status='active'`,
    [context.organizationId, id, opportunityId],
  );
  if (!existing.rows[0]) throw new CrmError(404, "Contact role not found.", "CRM_OPPORTUNITY_CONTACT_ROLE_NOT_FOUND");
  const role = Object.prototype.hasOwnProperty.call(input, "role")
    ? (input.role ? text(input.role) : null)
    : existing.rows[0].role;
  if (role && !OPPORTUNITY_CONTACT_ROLES.includes(role)) {
    throw new CrmError(400, "Choose a valid role.", "CRM_OPPORTUNITY_CONTACT_ROLE_INVALID", {
      errors: { role: ["Choose a valid role."] },
    });
  }
  const notes = Object.prototype.hasOwnProperty.call(input, "notes")
    ? text(input.notes) || null
    : existing.rows[0].notes;
  await client.query(
    `UPDATE tenant.crm_opportunity_contact_roles
     SET role=$3, notes=$4, updated_by=$5, updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, id, role, notes, context.userId],
  );
  if (input.isPrimary === true && !existing.rows[0].is_primary) {
    return setPrimaryOpportunityContactRole(client, context, opportunityId, id);
  }
  await queueOutboxEvent(client, context, "crm.opportunity_contact_role.updated", "opportunity", opportunityId, {
    opportunityContactRoleId: id,
  });
  return listOpportunityContactRoles(client, context, opportunityId);
}

export async function setPrimaryOpportunityContactRole(client, context, opportunityId, roleId) {
  await requireOpportunityInScope(client, context, opportunityId, { lock: false });
  const id = text(roleId);
  const target = await client.query(
    `SELECT id FROM tenant.crm_opportunity_contact_roles WHERE organization_id=$1 AND id=$2 AND opportunity_id=$3 AND status='active'`,
    [context.organizationId, id, opportunityId],
  );
  if (!target.rows[0]) throw new CrmError(404, "Contact role not found.", "CRM_OPPORTUNITY_CONTACT_ROLE_NOT_FOUND");
  await client.query(
    `UPDATE tenant.crm_opportunity_contact_roles
     SET is_primary=(id=$3), updated_by=$4, updated_at=now()
     WHERE organization_id=$1 AND opportunity_id=$2 AND status='active'`,
    [context.organizationId, opportunityId, id, context.userId],
  );
  await syncPrimaryOpportunityContactPointer(client, context, opportunityId);
  await queueOutboxEvent(client, context, "crm.opportunity_contact_role.primary_set", "opportunity", opportunityId, {
    opportunityContactRoleId: id,
  });
  return listOpportunityContactRoles(client, context, opportunityId);
}

export async function removeOpportunityContactRole(client, context, opportunityId, roleId, options = {}) {
  await requireOpportunityInScope(client, context, opportunityId, { lock: false });
  const id = text(roleId);
  const existing = await client.query(
    `SELECT * FROM tenant.crm_opportunity_contact_roles WHERE organization_id=$1 AND id=$2 AND opportunity_id=$3 AND status='active'`,
    [context.organizationId, id, opportunityId],
  );
  if (!existing.rows[0]) throw new CrmError(404, "Contact role not found.", "CRM_OPPORTUNITY_CONTACT_ROLE_NOT_FOUND");
  await client.query(
    `UPDATE tenant.crm_opportunity_contact_roles
     SET status='inactive', is_primary=false, updated_by=$3, updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, id, context.userId],
  );
  if (existing.rows[0].is_primary) {
    const promoteId = options.promoteRoleId ? text(options.promoteRoleId) : null;
    if (promoteId) {
      await setPrimaryOpportunityContactRole(client, context, opportunityId, promoteId);
    } else {
      await syncPrimaryOpportunityContactPointer(client, context, opportunityId);
    }
  }
  await queueOutboxEvent(client, context, "crm.opportunity_contact_role.removed", "opportunity", opportunityId, {
    opportunityContactRoleId: id,
  });
  return listOpportunityContactRoles(client, context, opportunityId);
}

// Reverse listing for the Contact Detail "Deals" tab — every Opportunity a
// Contact holds an active role on, not only the ones where they happen to
// be crm_opportunities.contact_id's current primary.
// Called from resource-mutation-service.js whenever the classic single
// contactId field is touched via the generic Opportunity create/update path
// (OpportunityFormScreen.tsx's "Contact" select still writes this field
// directly) — mirrors ensurePrimaryRelationshipFromLegacyFields's role for
// Contact<->Account exactly, so the two models never desync regardless of
// which UI/entry point a caller uses. Idempotent — safe to call whenever
// contactId is present in the update input, whether it actually changed or
// not.
export async function ensurePrimaryContactRoleFromLegacyField(client, context, opportunityId, contactId) {
  if (!contactId) {
    await client.query(
      `UPDATE tenant.crm_opportunity_contact_roles
       SET is_primary=false, updated_by=$3, updated_at=now()
       WHERE organization_id=$1 AND opportunity_id=$2 AND is_primary=true AND status='active'`,
      [context.organizationId, opportunityId, context.userId],
    );
    return;
  }
  await client.query(
    `UPDATE tenant.crm_opportunity_contact_roles
     SET is_primary=false, updated_by=$4, updated_at=now()
     WHERE organization_id=$1 AND opportunity_id=$2 AND contact_id<>$3 AND is_primary=true AND status='active'`,
    [context.organizationId, opportunityId, contactId, context.userId],
  );
  await client.query(
    `INSERT INTO tenant.crm_opportunity_contact_roles
       (organization_id, opportunity_id, contact_id, is_primary, status, created_by, updated_by)
     VALUES ($1,$2,$3,true,'active',$4,$4)
     ON CONFLICT (organization_id, opportunity_id, contact_id)
     DO UPDATE SET
       is_primary = true,
       status = 'active',
       updated_by = $4,
       updated_at = now()`,
    [context.organizationId, opportunityId, contactId, context.userId],
  );
}

export async function listContactOpportunityRoles(client, context, contactId) {
  const id = text(contactId);
  // The Contact must be visible to the caller (404 otherwise), and each deal
  // keeps its own Opportunity scope — Contact access is not deal access.
  await getCrmContact(client, context, id);
  const parameters = [context.organizationId, id];
  const scope = crmChildScopes(context, parameters);
  const result = await client.query(
    `SELECT ocr.*, opportunity.name AS opportunity_name, opportunity.status AS opportunity_status,
            opportunity.amount, opportunity.currency_code
       FROM tenant.crm_opportunity_contact_roles ocr
       JOIN tenant.crm_opportunities opportunity
         ON opportunity.organization_id=ocr.organization_id AND opportunity.id=ocr.opportunity_id
      WHERE ocr.organization_id=$1 AND ocr.contact_id=$2 AND ocr.status='active'${scope.opportunity()}
      ORDER BY ocr.is_primary DESC, opportunity.created_at DESC`,
    parameters,
  );
  return result.rows.map(camelize);
}
